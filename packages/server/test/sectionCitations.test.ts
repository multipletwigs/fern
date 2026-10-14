import { assert, layer } from "@effect/vitest";
import {
  FernApi,
  LiveRpcs,
  type SessionRounds,
  type Walkthrough,
} from "@repo/api";
import { Effect, Layer, Schedule, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { RpcTest } from "effect/rpc";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { vi } from "vitest";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import {
  type Draft,
  WalkthroughWriter,
  type WriteRequest,
} from "../src/walkthrough/WalkthroughWriter";
import { WorktreesDir } from "../src/worktree/Worktrees";

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd, encoding: "utf8" },
  ).trim();

const configDir = mkdtempSync(join(tmpdir(), "fern-claude-"));
process.env.CLAUDE_CONFIG_DIR = configDir;
const dataDir = realpathSync(mkdtempSync(join(tmpdir(), "fern-data-")));

// What Claude Code writes when it starts a Session: its transcript, under the folder it runs in.
const transcript = (
  cwd: string,
  id: string,
  text: string,
  entrypoint: string,
) => {
  const path = join(
    configDir,
    "projects",
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
    `${id}.jsonl`,
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({
      type: "user",
      uuid: crypto.randomUUID(),
      parentUuid: null,
      sessionId: id,
      timestamp: new Date().toISOString(),
      cwd,
      entrypoint,
      userType: "external",
      message: { role: "user", content: text },
    })}\n`,
  );
};

// A Project: a repo on `main` the developer has run a Session in.
const project = () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "fern-repo-")));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Initial");
  transcript(repo, crypto.randomUUID(), "Earlier work", "cli");
  return repo;
};

interface ToolResult {
  readonly content: ReadonlyArray<{ type: string; text: string }>;
  readonly isError?: boolean;
}
interface FernTool {
  readonly inputSchema: { parse: (args: unknown) => unknown };
  readonly handler: (args: unknown, extra: unknown) => Promise<ToolResult>;
}
interface TurnOptions {
  readonly cwd: string;
  readonly sessionId?: string;
  readonly mcpServers?: Record<
    string,
    { instance: { _registeredTools: Record<string, FernTool> } }
  >;
}

// Each turn Claude Code is asked to run, and how to end it.
interface StartedTurn {
  readonly sessionId: string | undefined;
  readonly text: string;
  readonly options: TurnOptions;
  readonly finish: () => void;
}
const started: Array<StartedTurn> = [];

// Only the Agent SDK's query() is faked: it records the turn, writes the transcript as Claude Code
// would, and runs until the test, playing the agent, ends it.
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const { scriptedQuery } = await import("./fakeClaude");
  return {
    ...(await importOriginal<object>()),
    query: scriptedQuery<TurnOptions>(({ sessionId, text, options, first }) => {
      const { promise: ended, resolve: finish } = Promise.withResolvers<void>();
      if (first && options.sessionId)
        transcript(options.cwd, options.sessionId, text, "sdk-ts");
      started.push({ sessionId, text, options, finish });
      return ended;
    }),
  };
});

// The Walkthrough writer, faked: what it's asked, and the draft a test has it answer with.
const requests: Array<WriteRequest> = [];
let answer: (request: WriteRequest) => Draft = () => ({
  sections: [],
  notFromSession: [],
});
const Writer = Layer.succeed(
  WalkthroughWriter,
  WalkthroughWriter.of({
    explore: () => Effect.die("unused"),
    write: (request) =>
      Effect.sync(() => {
        requests.push(request);
        const draft = answer(request);
        return { draft, revise: () => Effect.succeed(draft) };
      }),
  }),
);

const makeClient = HttpApiTest.groups(FernApi, ["sessions", "rounds"]);
const makeLive = RpcTest.makeClient(LiveRpcs);

const fern = Layer.mergeAll(
  handlersWith(Writer).pipe(
    Layer.provide([
      DatabaseLive(":memory:"),
      Layer.succeed(WorktreesDir, { dir: dataDir }),
    ]),
  ),
  HttpServer.layerServices,
);

// The `index`th turn run on the Session, once it starts.
const turnOf = (id: string, index: number) =>
  Effect.suspend(() =>
    Effect.fromNullishOr(started.filter((t) => t.sessionId === id)[index]),
  ).pipe(
    Effect.retry({ schedule: Schedule.spaced("5 millis"), times: 400 }),
    Effect.orDie,
  );

// The first value of the stream that satisfies the predicate.
const firstWhere = <A, E>(
  stream: Stream.Stream<A, E>,
  predicate: (a: A) => boolean,
) =>
  stream.pipe(
    Stream.filter(predicate),
    Stream.take(1),
    Stream.runCollect,
    Effect.map(([a]) => a),
    Effect.timeout("5 seconds"),
    Effect.orDie,
  );

interface Question {
  readonly title: string;
  readonly options: ReadonlyArray<string>;
  readonly recommended: string;
}

// A Session in the Project whose Grill settled one Decision per question: the agent posts a Round,
// and the developer picks the option or writes their own words. Returns the Session and the turn
// that got the answers, still running.
const grilled = (
  root: string,
  questions: ReadonlyArray<Question>,
  answers: ReadonlyArray<{ choice?: string; text?: string }>,
) =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    const live = yield* makeLive;
    const { id } = yield* client.sessions.start({
      payload: { root, message: { text: "Add a dark mode toggle" } },
    });
    const turn = yield* turnOf(id, 0);
    // oxlint-disable-next-line no-underscore-dangle -- the MCP server's own registry
    const tool = turn.options.mcpServers?.fern?.instance._registeredTools;
    const post = tool?.post_round;
    if (!post) throw new Error("No Fern tool post_round");
    yield* Effect.promise(() =>
      post.handler(
        post.inputSchema.parse({
          questions: questions.map((q) => ({
            ...q,
            body: "",
            reasoning: "",
          })),
        }),
        {},
      ),
    );
    turn.finish();
    const rounds = yield* firstWhere(
      live.Rounds({ session: id }),
      (r: SessionRounds) => r.open !== undefined,
    );
    const round = rounds?.open;
    yield* client.rounds.answer({
      params: { id: round?.id ?? "" },
      payload: {
        answers: (round?.questions ?? []).map((q, index) => ({
          question: q.id,
          ...answers[index],
        })),
      },
    });
    return { id, reply: yield* turnOf(id, 1) };
  });

// The Session's Walkthroughs, once one is written.
const walkthroughOf = (id: string) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    const all = yield* firstWhere(
      live.Walkthroughs({ session: id }),
      (walkthroughs: ReadonlyArray<Walkthrough>) =>
        walkthroughs.some((w) => w.status === "ready"),
    );
    const walkthrough = all?.find((w) => w.status === "ready");
    assert.isDefined(walkthrough);
    return walkthrough;
  });

layer(fern, { excludeTestServices: true })("Section citations", (it) => {
  it.effect(
    "Sections cite the Project's Decisions, from earlier Sessions too, and one citing none is Unplanned",
    () =>
      Effect.gen(function* () {
        const root = project();
        // An earlier Session of the Project settled where the toggle lives.
        const earlier = yield* grilled(
          root,
          [
            {
              title: "Where does the toggle live?",
              options: ["Settings page", "Top bar"],
              recommended: "Top bar",
            },
          ],
          [{ choice: "Settings page", text: "Next to the font size" }],
        );
        earlier.reply.finish();
        // Another Project's Decision is never offered.
        const elsewhere = yield* grilled(
          project(),
          [
            {
              title: "Which database?",
              options: ["SQLite", "Postgres"],
              recommended: "SQLite",
            },
          ],
          [{ choice: "SQLite" }],
        );
        elsewhere.reply.finish();

        const { id, reply } = yield* grilled(
          root,
          [
            {
              title: "Does it follow the system theme?",
              options: ["Yes", "No"],
              recommended: "Yes",
            },
          ],
          [{ choice: "Yes" }],
        );
        answer = (request) => {
          const cite = (question: string) =>
            request.decisions.find((d) => d.question === question)?.id ?? "";
          const [toggle, theme] = request.hunks.map((h) => h.id);
          return {
            sections: [
              {
                title: "Theme setting",
                explanation: "Follows the system.",
                hunks: [theme ?? ""],
                decisions: [
                  cite("Does it follow the system theme?"),
                  cite("Where does the toggle live?"),
                  // Made up by the Fork, and dropped.
                  "d99",
                  cite("Does it follow the system theme?"),
                ],
                risk: { level: "high", reason: " Touches every screen. " },
              },
              {
                title: "Toggle",
                explanation: "Adds the toggle.",
                hunks: [toggle ?? ""],
                decisions: [],
                risk: { level: "low", reason: "One button." },
              },
            ],
            notFromSession: [],
          };
        };
        // The agent makes the change and ends its turn, so Fern writes the Walkthrough.
        writeFileSync(join(reply.options.cwd, "b.ts"), "export const t = 1;\n");
        writeFileSync(join(reply.options.cwd, "c.ts"), "export const s = 1;\n");
        reply.finish();
        const walkthrough = yield* walkthroughOf(id);

        const request = requests.find((r) => r.sessionId === id);
        assert.deepStrictEqual(
          request?.decisions.map((d) => [d.question, d.answer]),
          [
            [
              "Where does the toggle live?",
              "Settings page. Next to the font size",
            ],
            ["Does it follow the system theme?", "Yes"],
          ],
        );
        assert.deepStrictEqual(
          walkthrough.sections.map((s) => ({
            title: s.title,
            decisions: s.decisions.map((d) => ({
              question: d.question,
              recommendation: d.recommendation,
              choice: d.choice,
              freeText: d.freeText,
            })),
            unplanned: s.unplanned,
            risk: s.risk,
          })),
          [
            {
              title: "Theme setting",
              decisions: [
                {
                  question: "Does it follow the system theme?",
                  recommendation: "Yes",
                  choice: "Yes",
                  freeText: undefined,
                },
                {
                  question: "Where does the toggle live?",
                  recommendation: "Top bar",
                  choice: "Settings page",
                  freeText: "Next to the font size",
                },
              ],
              unplanned: false,
              risk: { level: "high", reason: "Touches every screen." },
            },
            {
              title: "Toggle",
              decisions: [],
              unplanned: true,
              risk: { level: "low", reason: "One button." },
            },
          ],
        );
      }),
  );
});
