import { assert, layer } from "@effect/vitest";
import {
  FernApi,
  LiveRpcs,
  type SessionRounds,
  type Walkthrough,
  WalkthroughError,
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
import { CodeHost } from "../src/codehost/CodeHost";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import {
  type Draft,
  WalkthroughWriter,
  type WriteRequest,
} from "../src/walkthrough/WalkthroughWriter";
import { WorktreesDir } from "../src/worktree/Worktrees";
import { FakeIssues } from "./stubs";

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
  const file = join(
    configDir,
    "projects",
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
    `${id}.jsonl`,
  );
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
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

// A Project on GitHub: a repo on `main` with one commit, where the developer has run a Session.
const project = () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "fern-repo-")));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Initial");
  git(repo, "remote", "add", "origin", "git@github.com:acme/app.git");
  transcript(repo, crypto.randomUUID(), "Earlier work", "cli");
  return repo;
};

// The ticket's work as `/implement-spec` lands it: committed on a branch of its own, then merged
// into the Session's branch. The merge commit's hash.
const land = (cwd: string, ticket: number, files: Record<string, string>) => {
  const branch = `ticket-${ticket}-${crypto.randomUUID().slice(0, 6)}`;
  git(cwd, "checkout", "-q", "-b", branch);
  for (const [path, content] of Object.entries(files))
    writeFileSync(join(cwd, path), content);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", `Ticket #${ticket}`);
  git(cwd, "checkout", "-q", "-");
  git(cwd, "merge", "-q", "--no-ff", branch, "-m", `Merge #${ticket}`);
  return git(cwd, "rev-parse", "HEAD");
};

// The code host, faked: each PR description Fern set, in order, by the folder it asked from.
interface BodySet {
  readonly cwd: string;
  readonly pr: number;
  readonly body: string;
}
const bodies: Array<BodySet> = [];
let nextPr = 300;
const FakeCodeHost = Layer.succeed(
  CodeHost,
  CodeHost.of({
    ready: () => Effect.succeed(true),
    defaultBranch: () => Effect.succeed("main"),
    push: () => Effect.void,
    openDraft: () =>
      Effect.sync(() => {
        const number = ++nextPr;
        return { number, url: `https://github.com/acme/app/pull/${number}` };
      }),
    link: () => Effect.void,
    setBody: (cwd, pr, body) =>
      Effect.sync(() => {
        bodies.push({ cwd, pr, body });
      }),
    markReady: () => Effect.void,
    merge: () => Effect.void,
    state: () => Effect.succeed({ merged: false }),
  }),
);

// The Walkthrough writer, faked: it answers with the draft a test gives it, or fails while
// `failing`.
const requests: Array<WriteRequest> = [];
let failing = false;
let answer: (request: WriteRequest) => Draft = () => ({
  sections: [],
  notFromSession: [],
});
const Writer = Layer.succeed(
  WalkthroughWriter,
  WalkthroughWriter.of({
    write: (request) =>
      Effect.gen(function* () {
        requests.push(request);
        if (failing)
          return yield* new WalkthroughError({ message: "The Fork crashed" });
        const draft = answer(request);
        return { draft, revise: () => Effect.succeed(draft) };
      }),
  }),
);

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

const makeClient = HttpApiTest.groups(FernApi, ["sessions", "rounds", "flows"]);
const makeLive = RpcTest.makeClient(LiveRpcs);

const fern = Layer.mergeAll(
  handlersWith(Writer, FakeIssues, FakeCodeHost).pipe(
    Layer.provide([
      DatabaseLive(join(dataDir, "fern.db")),
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

const toolOf = (turn: StartedTurn, name: string) => {
  // oxlint-disable-next-line no-underscore-dangle -- the MCP server's own registry
  const tool = turn.options.mcpServers?.fern?.instance._registeredTools[name];
  if (!tool) throw new Error(`No Fern tool ${name}`);
  return tool;
};

// The agent calls one of Fern's tools, as Claude Code would: input checked against its schema,
// then handled.
const callTool = (turn: StartedTurn, name: string, args: unknown) =>
  Effect.promise(() => {
    const tool = toolOf(turn, name);
    return tool.handler(tool.inputSchema.parse(args), {});
  });

// A Session in the Project whose Grill settled one Decision: the agent posts a Round of one
// question, and the developer answers it. The Session and the turn that got the answer, still
// running.
const grilled = (root: string, reply: { choice?: string; text?: string }) =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    const live = yield* makeLive;
    const { id } = yield* client.sessions.start({
      payload: {
        root,
        message: { text: "/grill-with-docs Add a dark mode toggle" },
      },
    });
    const turn = yield* turnOf(id, 0);
    yield* callTool(turn, "post_round", {
      questions: [
        {
          title: "Where does the toggle live?",
          body: "",
          options: ["Settings page", "Top bar"],
          recommended: "Top bar",
          reasoning: "",
        },
      ],
    });
    turn.finish();
    const rounds = yield* firstWhere(
      live.Rounds({ session: id }),
      (r: SessionRounds) => r.open !== undefined,
    );
    const round = rounds?.open;
    yield* client.rounds.answer({
      params: { id: round?.id ?? "" },
      payload: {
        answers: (round?.questions ?? []).map((q) => ({
          question: q.id,
          ...reply,
        })),
      },
    });
    return { id, turn: yield* turnOf(id, 1) };
  });

// The Session's turn on the first message Fern sent it that satisfies the predicate.
const turnWhere = (id: string, predicate: (text: string) => boolean) =>
  Effect.suspend(() =>
    Effect.fromNullishOr(
      started.find((t) => t.sessionId === id && predicate(t.text)),
    ),
  ).pipe(
    Effect.retry({ schedule: Schedule.spaced("5 millis"), times: 400 }),
    Effect.orDie,
  );

// The agent reports the Phase done in the turn and ends it; the developer approves the Checkpoint.
const doneAndApproved = (
  id: string,
  turn: StartedTurn,
  phase: string,
  extra: Record<string, unknown> = {},
) =>
  Effect.gen(function* () {
    yield* callTool(turn, "phase_done", {
      phase,
      summary: `${phase} done.`,
      ...extra,
    });
    turn.finish();
    const live = yield* makeLive;
    const flow = yield* firstWhere(
      live.Flow({ session: id }),
      (f) => f?.checkpoint?.phase === phase,
    );
    const client = yield* makeClient;
    yield* client.flows.approve({ params: { id: flow?.checkpoint?.id ?? "" } });
  });

// The grilled Session taken through Spec (the Brief #2, its tickets #3 and #4): its turn on
// `/implement-spec`.
const specced = (id: string, grill: StartedTurn) =>
  Effect.gen(function* () {
    yield* doneAndApproved(id, grill, "grill");
    (yield* turnWhere(id, (text) => text === "/to-spec")).finish();
    yield* doneAndApproved(
      id,
      yield* turnWhere(id, (text) => text === "/to-tickets"),
      "spec",
      { spec: { brief: 2, tickets: [3, 4] } },
    );
    return yield* turnWhere(id, (text) => text.startsWith("/implement-spec"));
  });

// The Session's Walkthroughs once they satisfy the condition.
const walkthroughsWhen = (
  id: string,
  condition: (all: ReadonlyArray<Walkthrough>) => boolean,
) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    return (
      (yield* firstWhere(live.Walkthroughs({ session: id }), condition)) ?? []
    );
  });

// The descriptions Fern set on the PR, once there are `count` of them.
const bodiesOf = (pr: number, count: number) =>
  Effect.suspend(() => {
    const set = bodies.filter((b) => b.pr === pr);
    return set.length >= count
      ? Effect.succeed(set)
      : Effect.fail("not yet" as const);
  }).pipe(
    Effect.retry({ schedule: Schedule.spaced("5 millis"), times: 400 }),
    Effect.orDie,
  );

const prNumber = (result: ToolResult) =>
  Number(/draft PR #(\d+)/.exec(result.content[0]?.text ?? "")?.[1]);

layer(fern, { excludeTestServices: true })("PR descriptions", (it) => {
  it.effect(
    "once a PR's Walkthrough is written, it becomes the PR's description: each Section's title, Risk, prose and cited Decisions, no hunks, the Unexplained changes counted, closing the ticket",
    () =>
      Effect.gen(function* () {
        const grill = yield* grilled(project(), {
          choice: "Settings page",
          text: "Next to the font size",
        });
        const { id } = grill;
        const turn = yield* specced(id, grill.turn);
        const cwd = turn.options.cwd;
        answer = (request) => {
          const hunk = (path: string) =>
            request.hunks.find((h) => h.path === path)?.id ?? "";
          return {
            sections: [
              {
                title: "The toggle on the settings page",
                explanation: "Adds a **toggle** under the font size.",
                hunks: [hunk("toggle.ts")],
                decisions: [request.decisions[0]?.id ?? ""],
                risk: { level: "medium", reason: "Every screen reads it." },
              },
              {
                title: "A theme constant",
                explanation: "Names the dark theme.",
                hunks: [hunk("theme.ts")],
                decisions: [],
                risk: { level: "low", reason: "One constant." },
              },
            ],
            notFromSession: [],
          };
        };

        const landed = yield* callTool(turn, "ticket_landed", {
          ticket: 3,
          commit: land(cwd, 3, {
            "toggle.ts": "export const toggle = 1;\n",
            "theme.ts": "export const theme = 1;\n",
            "stray.ts": "export const stray = 1;\n",
          }),
        });
        turn.finish();
        const pr = prNumber(landed);
        yield* walkthroughsWhen(id, (ws) => ws[0]?.status === "ready");
        const [set] = yield* bodiesOf(pr, 1);

        assert.strictEqual(set?.cwd, cwd);
        assert.strictEqual(
          set?.body,
          [
            "## The toggle on the settings page",
            "",
            "**Risk: medium.** Every screen reads it.",
            "",
            "Adds a **toggle** under the font size.",
            "",
            "**Decisions**",
            "",
            "- **Where does the toggle live?** Answer: Settings page. Next to the font size",
            "",
            "## A theme constant",
            "",
            "**Risk: low.** One constant.",
            "",
            "Names the dark theme.",
            "",
            "**Unplanned:** this Section cites no Decision.",
            "",
            "---",
            "",
            "1 change no Section explains.",
            "",
            "Closes #3",
            "",
          ].join("\n"),
        );
      }),
  );

  it.effect(
    "a PR whose Walkthrough fails keeps the description it opened with",
    () =>
      Effect.gen(function* () {
        failing = true;
        const grill = yield* grilled(project(), { choice: "Top bar" });
        const { id } = grill;
        const turn = yield* specced(id, grill.turn);
        const landed = yield* callTool(turn, "ticket_landed", {
          ticket: 4,
          commit: land(turn.options.cwd, 4, {
            "toggle.ts": "export const toggle = 1;\n",
          }),
        });
        turn.finish();

        yield* walkthroughsWhen(id, (ws) => ws[0]?.status === "failed");
        yield* Effect.sleep("100 millis");
        assert.deepStrictEqual(
          bodies.filter((b) => b.pr === prNumber(landed)),
          [],
        );
      }).pipe(Effect.ensuring(Effect.sync(() => (failing = false)))),
  );
});
