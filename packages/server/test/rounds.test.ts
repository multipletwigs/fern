import { assert, layer } from "@effect/vitest";
import { FernApi, LiveRpcs, type SessionRounds } from "@repo/api";
import { Effect, Layer, Schedule, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { RpcTest } from "effect/rpc";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { vi } from "vitest";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import { WorktreesDir } from "../src/worktree/Worktrees";
import { NoWriter } from "./stubs";

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd, encoding: "utf8" },
  ).trim();

const configDir = mkdtempSync(join(tmpdir(), "fern-claude-"));
process.env.CLAUDE_CONFIG_DIR = configDir;
const dataDir = realpathSync(mkdtempSync(join(tmpdir(), "fern-data-")));
// A file, not :memory:, so Fern can be started again on the same records.
const db = join(dataDir, "fern.db");

// What Claude Code writes when it starts a Session: its transcript, under the folder it runs in.
const transcriptPath = (cwd: string, id: string) =>
  join(configDir, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${id}.jsonl`);
const transcript = (
  cwd: string,
  id: string,
  text: string,
  entrypoint: string,
) => {
  mkdirSync(dirname(transcriptPath(cwd, id)), { recursive: true });
  writeFileSync(
    transcriptPath(cwd, id),
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
const repo = realpathSync(mkdtempSync(join(tmpdir(), "fern-repo-")));
git(repo, "init", "-q", "-b", "main");
writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
git(repo, "add", "-A");
git(repo, "commit", "-q", "-m", "Initial");
transcript(repo, crypto.randomUUID(), "Earlier work", "cli");

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
  readonly resume?: string;
  readonly allowedTools?: Array<string>;
  readonly systemPrompt?: { append?: string };
  readonly mcpServers?: Record<
    string,
    { instance: { _registeredTools: Record<string, FernTool> } }
  >;
}

// Each turn Claude Code is asked to run: on which Session, its message, the options it ran with,
// and how to end it.
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

const makeClient = HttpApiTest.groups(FernApi, ["sessions", "rounds"]);
const makeLive = RpcTest.makeClient(LiveRpcs);

// Fern, on the records in `db`.
const fern = Layer.mergeAll(
  handlersWith(NoWriter).pipe(
    Layer.provide([
      DatabaseLive(db),
      Layer.succeed(WorktreesDir, { dir: dataDir }),
    ]),
  ),
  HttpServer.layerServices,
);

// The `index`th turn run on the Session, once it starts.
const turnOf = (id: string, index = 0) =>
  Effect.suspend(() =>
    Effect.fromNullishOr(started.filter((t) => t.sessionId === id)[index]),
  ).pipe(
    Effect.retry({ schedule: Schedule.spaced("5 millis"), times: 400 }),
    Effect.orDie,
  );

const startSession = (text: string) =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    const { id } = yield* client.sessions.start({
      payload: { root: repo, message: { text } },
    });
    return { id, turn: yield* turnOf(id) };
  });

// The agent calls one of Fern's tools, as Claude Code would: input checked against its schema,
// then handled.
const callTool = (turn: StartedTurn, name: string, args: unknown) =>
  Effect.promise(() => {
    // oxlint-disable-next-line no-underscore-dangle -- the MCP server's own registry
    const tool = turn.options.mcpServers?.fern?.instance._registeredTools[name];
    if (!tool) throw new Error(`No Fern tool ${name}`);
    return tool.handler(tool.inputSchema.parse(args), {});
  });

const twoQuestions = {
  questions: [
    {
      title: "Where does the toggle live?",
      body: "The settings page or the top bar.",
      options: ["Settings page", "Top bar"],
      recommended: "Top bar",
      reasoning: "It's used often enough to stay one click away.",
    },
    {
      title: "Does it follow the system theme?",
      body: "Until the developer picks one.",
      options: ["Yes", "No"],
      recommended: "Yes",
      reasoning: "Matches what the OS already says.",
    },
  ],
};

// The Session's Rounds once they satisfy the condition.
const roundsWhen = (id: string, condition: (r: SessionRounds) => boolean) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    const [rounds] = yield* live
      .Rounds({ session: id })
      .pipe(
        Stream.filter(condition),
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("5 seconds"),
      );
    return rounds;
  });

// The agent posts the Round and ends its turn; Fern shows it.
const postRound = (id: string, turn: StartedTurn) =>
  Effect.gen(function* () {
    const result = yield* callTool(turn, "post_round", twoQuestions);
    turn.finish();
    const rounds = yield* roundsWhen(id, (r) => r.open !== undefined);
    return { result, round: rounds?.open };
  });

layer(fern, { excludeTestServices: true })("Rounds", (it) => {
  it.effect(
    "gives a Hosted Session the Round tool, allowed, with steering to ask Grill questions only through it",
    () =>
      Effect.gen(function* () {
        const { turn } = yield* startSession("Add a dark mode toggle");
        turn.finish();

        assert.include(
          turn.options.allowedTools ?? [],
          "mcp__fern__post_round",
        );
        assert.match(
          turn.options.systemPrompt?.append ?? "",
          /Grill questions only through the post_round tool/,
        );
      }),
  );

  it.effect(
    "shows a Round the agent posts on the Session's live stream, and tells the agent to end its turn",
    () =>
      Effect.gen(function* () {
        const { id, turn } = yield* startSession("Add a dark mode toggle");
        const { result, round } = yield* postRound(id, turn);

        assert.isNotTrue(result.isError);
        assert.match(
          result.content[0]?.text ?? "",
          /answers arrive as your next message/,
        );
        assert.deepStrictEqual(
          round?.questions.map((q) => [q.title, q.options, q.recommended]),
          [
            [
              "Where does the toggle live?",
              ["Settings page", "Top bar"],
              "Top bar",
            ],
            ["Does it follow the system theme?", ["Yes", "No"], "Yes"],
          ],
        );
        assert.strictEqual(
          round?.questions[0]?.reasoning,
          "It's used often enough to stay one click away.",
        );
      }),
  );

  it.effect(
    "records a Decision per question when the developer answers, and sends every answer back in one message",
    () =>
      Effect.gen(function* () {
        const { id, turn } = yield* startSession("Add a dark mode toggle");
        const { round } = yield* postRound(id, turn);
        const [first, second] = round?.questions ?? [];
        const client = yield* makeClient;

        yield* client.rounds.answer({
          params: { id: round?.id ?? "" },
          payload: {
            answers: [
              { question: first?.id ?? "", choice: "Top bar" },
              { question: second?.id ?? "", text: "Only on macOS for now" },
            ],
          },
        });

        const reply = yield* turnOf(id, 1);
        reply.finish();
        assert.strictEqual(
          reply.text,
          [
            "My answers to your Round:",
            "",
            "1. Where does the toggle live?",
            "   Top bar (your recommendation)",
            "",
            "2. Does it follow the system theme?",
            "   Only on macOS for now",
          ].join("\n"),
        );
        const rounds = yield* roundsWhen(
          id,
          (r) => r.open === undefined && r.decisions.length === 2,
        );
        assert.deepStrictEqual(
          rounds?.decisions.map((d) => ({
            project: d.project,
            session: d.sessionId,
            round: d.roundId,
            question: d.question,
            choice: d.choice,
            freeText: d.freeText,
            recommended: d.recommended,
          })),
          [
            {
              project: repo,
              session: id,
              round: round?.id ?? "",
              question: "Where does the toggle live?",
              choice: "Top bar",
              freeText: undefined,
              recommended: true,
            },
            {
              project: repo,
              session: id,
              round: round?.id ?? "",
              question: "Does it follow the system theme?",
              choice: undefined,
              freeText: "Only on macOS for now",
              recommended: false,
            },
          ],
        );
      }),
  );

  it.effect("sends the answers into a turn that's still running", () =>
    Effect.gen(function* () {
      const { id, turn } = yield* startSession("Add a dark mode toggle");
      const { round } = yield* postRound(id, turn);
      // The developer argued a point in the chat instead, and the agent is still replying.
      const client = yield* makeClient;
      yield* client.sessions.send({
        params: { id },
        payload: { text: "Why not both places?" },
      });
      const chat = yield* turnOf(id, 1);

      yield* client.rounds.answer({
        params: { id: round?.id ?? "" },
        payload: {
          answers: (round?.questions ?? []).map((q) => ({
            question: q.id,
            choice: q.recommended,
          })),
        },
      });
      // This agent takes them in once its reply ends.
      yield* Effect.sleep("50 millis");
      assert.strictEqual(started.filter((t) => t.sessionId === id).length, 2);

      chat.finish();
      const reply = yield* turnOf(id, 2);
      reply.finish();
      assert.match(reply.text, /^My answers to your Round:/);
    }),
  );

  it.effect(
    "turns away answers that leave a question out or pick an option it doesn't offer, and a second answer",
    () =>
      Effect.gen(function* () {
        const { id, turn } = yield* startSession("Add a dark mode toggle");
        const { round } = yield* postRound(id, turn);
        const [first, second] = round?.questions ?? [];
        const client = yield* makeClient;
        const answer = (
          answers: ReadonlyArray<{ question: string; choice?: string }>,
        ) =>
          client.rounds.answer({
            params: { id: round?.id ?? "" },
            payload: { answers },
          });

        const missing = yield* answer([
          { question: first?.id ?? "", choice: "Top bar" },
        ]).pipe(Effect.flip);
        assert.strictEqual(missing._tag, "InvalidAnswers");
        const unknown = yield* answer([
          { question: first?.id ?? "", choice: "Sidebar" },
          { question: second?.id ?? "", choice: "Yes" },
        ]).pipe(Effect.flip);
        assert.strictEqual(unknown._tag, "InvalidAnswers");

        const all = [
          { question: first?.id ?? "", choice: "Top bar" },
          { question: second?.id ?? "", choice: "Yes" },
        ];
        yield* answer(all);
        const again = yield* answer(all).pipe(Effect.flip);
        assert.strictEqual(again._tag, "RoundClosed");
        (yield* turnOf(id, 1)).finish();
      }),
  );

  it.effect(
    "keeps an open Round waiting across a restart of Fern, and takes its answers there",
    () =>
      Effect.gen(function* () {
        const { id, turn } = yield* startSession("Add a dark mode toggle");
        const { round } = yield* postRound(id, turn);

        // Fern starts again on the same records, a while later.
        const later = new Date(Date.now() - 60_000);
        utimesSync(transcriptPath(turn.options.cwd, id), later, later);
        yield* Effect.gen(function* () {
          const rounds = yield* roundsWhen(id, (r) => r.open !== undefined);
          assert.strictEqual(rounds?.open?.id, round?.id);
          assert.deepStrictEqual(
            rounds?.open?.questions.map((q) => q.title),
            ["Where does the toggle live?", "Does it follow the system theme?"],
          );

          const client = yield* makeClient;
          yield* client.rounds.answer({
            params: { id: round?.id ?? "" },
            payload: {
              answers: (round?.questions ?? []).map((q) => ({
                question: q.id,
                choice: q.recommended,
              })),
            },
          });
          const reply = yield* turnOf(id, 1);
          reply.finish();
          assert.match(reply.text, /^My answers to your Round:/);
          // oxlint-disable-next-line effecttsgo/strict-effect-provide -- a second Fern, started afresh
        }).pipe(Effect.provide(fern, { local: true }));
      }),
  );

  it.effect(
    "answers the agent with what's wrong when its Round recommends an option it doesn't offer",
    () =>
      Effect.gen(function* () {
        const { id, turn } = yield* startSession("Add a dark mode toggle");
        const result = yield* callTool(turn, "post_round", {
          questions: [
            {
              title: "Where does the toggle live?",
              body: "",
              options: ["Settings page", "Top bar"],
              recommended: "Sidebar",
              reasoning: "",
            },
          ],
        });
        turn.finish();

        assert.isTrue(result.isError);
        assert.match(result.content[0]?.text ?? "", /isn't one of its options/);
        const rounds = yield* roundsWhen(id, () => true);
        assert.isUndefined(rounds?.open);
      }),
  );
});
