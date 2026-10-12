import { assert, layer } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import { vi } from "vitest";
import { DatabaseLive } from "../src/database/Database";
import { GitError } from "../src/git/Git";
import { Snapshots } from "../src/snapshot/Snapshots";
import { FernTools } from "../src/turn/FernTools";
import { HostedSessions } from "../src/turn/HostedSessions";
import { Turns } from "../src/turn/Turns";
import { holdAt, processes, scripts } from "./fakeClaude";
import { UnusedWorktrees } from "./stubs";

// Replays message sequences captured from the real Claude Code CLI (0.3.296, Haiku), trimmed to the
// fields Turns reads, on the Session's long-lived process.

const SESSION = "2c9ad25b-9de1-43f3-a556-86a845165b20";

vi.mock("@anthropic-ai/claude-agent-sdk", async () => {
  const { replayQuery } = await import("./fakeClaude");
  return {
    getSessionInfo: () =>
      Promise.resolve({ sessionId: SESSION, lastModified: 0, cwd: "/repo" }),
    query: replayQuery,
  };
});

type Step = Record<string, unknown>;

const init = { type: "system", subtype: "init", model: "claude-haiku" };
const assistant = (text: string) => ({
  type: "assistant",
  parent_tool_use_id: null,
  message: { role: "assistant", content: [{ type: "text", text }] },
});
// A result, with the messages its turn took in.
const result = (text: string, turns: number, taken: ReadonlyArray<string>) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: turns,
  result: text,
  user_message_uuids: taken,
  modelUsage: { "claude-haiku": { contextWindow: 1_000 } },
});
const subagent = {
  task_id: "af84be11567442a0f",
  task_type: "local_agent",
  subagent_type: "general-purpose",
  description: "Run sleep 15",
};
const tasksChanged = (tasks: ReadonlyArray<object>) => ({
  type: "system",
  subtype: "background_tasks_changed",
  tasks,
});
const notified = (status: string) => ({
  type: "system",
  subtype: "task_notification",
  task_id: subagent.task_id,
  status,
});

// A turn whose agent launches a background subagent: the main loop's result arrives while the
// subagent runs, and its notification then runs as another turn, ending in a second result.
const backgroundSubagent: ReadonlyArray<Step> = [
  { send: "spawn a background agent" },
  init,
  { type: "assistant", message: { content: [{ type: "tool_use" }] } },
  tasksChanged([subagent]),
  { type: "system", subtype: "task_started", task_id: subagent.task_id },
  assistant("launched"),
  result("launched", 2, ["$1"]),
  { type: "system", subtype: "task_progress", task_id: subagent.task_id },
  notified("completed"),
  tasksChanged([]),
  init,
  assistant("The background subagent finished."),
  result("The background subagent finished.", 1, []),
];

// Resuming a Session whose subagent was killed: the stopped notification gets an empty result,
// with no model call, before Claude Code answers the message.
const resumeAfterKilledSubagent: ReadonlyArray<Step> = [
  { send: "ping" },
  notified("stopped"),
  init,
  result("", 0, []),
  init,
  assistant("pong"),
  result("pong", 1, ["$1"]),
];

const NoSnapshots = Layer.succeed(
  Snapshots,
  // Only `repo` is reached, and a folder outside git just has no Walkthroughs.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  { repo: () => Effect.fail(new GitError({ message: "not a repo" })) } as never,
);
const TestTurns = Turns.layer.pipe(
  Layer.provide([
    DatabaseLive(":memory:"),
    NoSnapshots,
    Layer.succeed(
      HostedSessions,
      HostedSessions.of({
        record: () => Effect.void,
        archive: () => Effect.die("unused"),
        worktrees: Effect.succeed([]),
        sessions: Effect.succeed([]),
        session: () => Effect.undefined,
        changes: Stream.never,
        listed: Effect.succeed([]),
        isProject: () => Effect.succeed(true),
        isHosted: () => Effect.succeed(false),
        projectOf: () => Effect.die("unused"),
      }),
    ),
    Layer.succeed(
      FernTools,
      FernTools.of({
        register: () => Effect.void,
        options: () => Effect.die("unused"),
      }),
    ),
    UnusedWorktrees,
  ]),
);

const tick = Effect.promise(
  () => new Promise((resolve) => setTimeout(resolve, 5)),
);

// Gives the Session's fibers moments to move until the condition holds.
const until = (condition: () => boolean) =>
  Effect.gen(function* () {
    for (let i = 0; i < 200 && !condition(); i++) yield* tick;
  });

const idle = (turns: Turns["Service"]) =>
  Effect.gen(function* () {
    for (let i = 0; i < 200; i++) {
      if ((yield* turns.turn(SESSION))?.running === false) return;
      yield* tick;
    }
  });

// A new process for the Session, playing the script.
const fresh = (script: ReadonlyArray<Step>) =>
  Effect.gen(function* () {
    yield* (yield* Turns).close(SESSION);
    processes.length = 0;
    scripts.length = 0;
    scripts.push(script);
  });

layer(TestTurns, { excludeTestServices: true })(
  "Turns with background tasks",
  (it) => {
    it.effect(
      "keeps the turn open until its background subagent's notification turn ends, and the process after it",
      () =>
        Effect.gen(function* () {
          yield* fresh(backgroundSubagent);
          const turns = yield* Turns;
          const finished: Array<string> = [];
          yield* turns.finished.pipe(
            Stream.runForEach((turn) =>
              Effect.sync(() => finished.push(turn.id)),
            ),
            Effect.forkScoped,
          );
          yield* tick;
          // The subagent's work takes a while.
          const working = holdAt((label) => label === "task_progress");
          yield* turns.send(SESSION, { text: "spawn a background agent" });
          yield* until(() => working.reached);

          // The main loop's result is in, but the subagent is still working: the Session runs.
          assert.include(processes[0]?.log ?? [], `result "launched"`);
          const meanwhile = yield* turns.turn(SESSION);
          assert.isTrue(meanwhile?.running);
          // The result reported the context window, so the ring shows it before the turn ends.
          assert.strictEqual(meanwhile?.contextWindow, 1_000);
          assert.strictEqual(yield* turns.contextWindow(SESSION), 1_000);
          assert.deepStrictEqual(finished, []);

          working.release();
          yield* until(() => processes[0]?.waiting === "end");
          yield* idle(turns);
          assert.isFalse((yield* turns.turn(SESSION))?.running);
          assert.deepStrictEqual(finished, [SESSION]);
          // The process stays, so nothing the subagents run is killed.
          assert.notInclude(processes[0]?.log ?? [], "close");
        }),
    );

    it.effect(
      "receives the reply after the empty result that follows a resume",
      () =>
        Effect.gen(function* () {
          yield* fresh(resumeAfterKilledSubagent);
          const turns = yield* Turns;
          yield* turns.send(SESSION, { text: "ping" });
          yield* until(() => processes[0]?.waiting === "end");
          yield* idle(turns);
          assert.deepStrictEqual(processes[0]?.log, [
            "sent ping",
            "task_notification",
            "init",
            `result ""`,
            "init",
            "assistant pong",
            `result "pong"`,
          ]);
          assert.isFalse((yield* turns.turn(SESSION))?.running);
        }),
    );

    it.effect(
      "ends at the empty result of a command that answers nothing",
      () =>
        Effect.gen(function* () {
          // What /clear sends.
          yield* fresh([
            { send: "/clear" },
            { type: "conversation_reset" },
            init,
            result("", 0, ["$1"]),
          ]);
          const turns = yield* Turns;
          yield* turns.send(SESSION, { text: "/clear" });
          yield* until(() => processes[0]?.waiting === "end");
          yield* idle(turns);
          assert.isFalse((yield* turns.turn(SESSION))?.running);
        }),
    );

    it.effect("stops a turn with a background subagent at once", () =>
      Effect.gen(function* () {
        yield* fresh([
          { send: "spawn a background agent" },
          init,
          tasksChanged([subagent]),
          result("launched", 2, ["$1"]),
          { interrupt: { still_queued: [] } },
          {
            type: "result",
            subtype: "error_during_execution",
            is_error: true,
            num_turns: 0,
            errors: [],
            result: "stopped",
            modelUsage: {},
          },
        ]);
        const turns = yield* Turns;
        yield* turns.send(SESSION, { text: "spawn a background agent" });
        yield* until(() => processes[0]?.waiting === "interrupt");
        const before = Date.now();
        yield* turns.interrupt(SESSION);
        assert.isBelow(Date.now() - before, 1_000);
        assert.include(processes[0]?.log ?? [], `result "stopped"`);
        assert.isFalse((yield* turns.turn(SESSION))?.running);
        assert.isUndefined((yield* turns.turn(SESSION))?.error);
        assert.isFalse(processes[0]?.closed);
      }),
    );
  },
);
