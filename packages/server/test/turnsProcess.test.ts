import { assert, layer } from "@effect/vitest";
import { Duration, Effect, Layer, Stream } from "effect";
import { TestClock } from "effect/testing";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { vi } from "vitest";
import { FernApi } from "@repo/api";
import { DatabaseLive } from "../src/database/Database";
import { GitError } from "../src/git/Git";
import { HandlersNoDeps } from "../src/http";
import { Snapshots } from "../src/snapshot/Snapshots";
import { FernTools } from "../src/turn/FernTools";
import { HostedSessions } from "../src/turn/HostedSessions";
import { IDLE_TIMEOUT, Turns } from "../src/turn/Turns";
import { holdAt, processes, scripts } from "./fakeClaude";
import midTurn from "./fixtures/midTurn.json";
import queuedCommand from "./fixtures/queuedCommand.json";
import stop from "./fixtures/stop.json";
import {
  NoEscapes,
  UnusedCommands,
  UnusedFlows,
  UnusedRounds,
  UnusedTranscripts,
  UnusedWalkthroughs,
  UnusedWorkspace,
  UnusedWorktreeCleanup,
  UnusedSubagents,
  UnusedVerifySlots,
  UnusedWorktrees,
} from "./stubs";

// One long-lived Claude Code process per Session, fed through its open input. The process replays
// message sequences captured from the real CLI (see test/fixtures).

const SESSION = "0c1a332f-4098-477e-b663-7ca0c2a7efde";
const OTHER = "9b1e5c3a-2f4d-4e8a-b6c7-0d1e2f3a4b5c";

vi.mock("@anthropic-ai/claude-agent-sdk", async () => {
  const { replayQuery } = await import("./fakeClaude");
  return {
    getSessionInfo: () =>
      Promise.resolve({ sessionId: SESSION, lastModified: 0, cwd: "/repo" }),
    query: replayQuery,
  };
});

let opening = Promise.resolve();

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
        // Opening a process waits while a test holds it.
        isHosted: () => Effect.promise(() => opening).pipe(Effect.as(false)),
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
    for (let i = 0; i < 400 && !condition(); i++) yield* tick;
    assert.isTrue(condition(), "timed out");
  });
const waitingFor = (step: string) =>
  until(() => processes.at(-1)?.waiting === step);
// Waits for the Session's turn to end.
const idle = (turns: Turns["Service"], id = SESSION) =>
  Effect.gen(function* () {
    for (let i = 0; i < 400; i++) {
      if ((yield* turns.turn(id))?.running === false) return;
      yield* tick;
    }
    assert.fail("still running");
  });

// Short sequences in the shape the real CLI sends.
const init = { type: "system", subtype: "init", model: "claude-haiku" };
const reply = (text: string) => ({
  type: "assistant",
  parent_tool_use_id: null,
  message: { role: "assistant", content: [{ type: "text", text }] },
});
const result = (text: string, taken: ReadonlyArray<string>) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 1,
  result: text,
  user_message_uuids: taken,
  modelUsage: { "claude-haiku": { contextWindow: 1_000 } },
});

const fresh = (
  ...next: ReadonlyArray<{ steps: ReadonlyArray<Record<string, unknown>> }>
) => {
  processes.length = 0;
  scripts.length = 0;
  scripts.push(...next.map((fixture) => fixture.steps));
};

layer(TestTurns, { excludeTestServices: true })("A Session's process", (it) => {
  it.effect(
    "delivers a message sent mid-turn at the next tool call, and the agent acts on it in the same turn",
    () =>
      Effect.gen(function* () {
        fresh(midTurn);
        const turns = yield* Turns;
        yield* turns.send(SESSION, {
          text: "Run `sleep 2` with Bash three separate times, one call each, then say FINISHED",
        });
        yield* waitingFor("send Also say BANANA at the very end");
        assert.isTrue((yield* turns.turn(SESSION))?.running);

        // Claude Code holds the message until the running tool call returns.
        const toolResult = holdAt((label) => label === "user");
        yield* turns.send(SESSION, { text: "Also say BANANA at the very end" });
        yield* until(() => toolResult.reached);
        const [queued] = (yield* turns.turn(SESSION))?.queued ?? [];
        assert.deepInclude(queued, {
          text: "Also say BANANA at the very end",
          images: 0,
          delivered: true,
        });
        // It's with Claude Code, so it can't be taken back.
        const refused = yield* turns
          .unqueue(SESSION, queued?.id ?? "")
          .pipe(Effect.flip);
        assert.strictEqual(refused._tag, "MessageDelivered");

        // Taken in at the next tool call: it leaves the queue while the turn goes on.
        const nextCall = holdAt((label) => label === "assistant Bash");
        toolResult.release();
        yield* until(() => nextCall.reached);
        assert.isUndefined((yield* turns.turn(SESSION))?.queued);
        assert.isTrue((yield* turns.turn(SESSION))?.running);
        nextCall.release();
        yield* waitingFor("send Reply only PING2");

        const [process] = processes;
        assert.strictEqual(processes.length, 1);
        // Taken in before the turn's result, which answers it.
        const log = process?.log ?? [];
        assert.isBelow(
          log.indexOf("sent Also say BANANA at the very end"),
          log.indexOf(`result "FINISHED\\nBANANA"`),
        );
        assert.isAbove(log.indexOf(`result "FINISHED\\nBANANA"`), 0);
        const after = yield* turns.turn(SESSION);
        assert.isFalse(after?.running);
        assert.isUndefined(after?.queued);
        assert.isUndefined(after?.error);
        assert.isFalse(process?.closed);
      }),
  );

  it.effect(
    "starts a new turn in the same process when a message is sent while idle",
    () =>
      Effect.gen(function* () {
        const turns = yield* Turns;
        const finished: Array<string> = [];
        yield* turns.finished.pipe(
          Stream.runForEach((turn) =>
            Effect.sync(() => finished.push(turn.id)),
          ),
          Effect.forkScoped,
        );
        yield* tick;

        yield* turns.send(SESSION, { text: "Reply only PING2" });
        assert.isTrue((yield* turns.turn(SESSION))?.running);
        yield* until(() => processes[0]?.waiting === "end");
        yield* until(() => finished.length === 1);

        assert.strictEqual(processes.length, 1);
        assert.deepStrictEqual(processes[0]?.log.slice(-3), [
          "init",
          "assistant PING2",
          `result "PING2"`,
        ]);
        assert.isFalse((yield* turns.turn(SESSION))?.running);
        assert.deepStrictEqual(finished, [SESSION]);
      }),
  );

  it.effect(
    "keeps the turn running through a slash command sent mid-turn, which runs as a turn of its own",
    () =>
      Effect.gen(function* () {
        fresh(queuedCommand);
        const turns = yield* Turns;
        // A fresh process for the Session.
        yield* turns.close(SESSION);
        const finished: Array<string> = [];
        yield* turns.finished.pipe(
          Stream.runForEach((turn) =>
            Effect.sync(() => finished.push(turn.id)),
          ),
          Effect.forkScoped,
        );
        yield* tick;
        yield* turns.send(SESSION, {
          text: "Run `sleep 2` with Bash two separate times, one call each, then say SLASHDONE",
        });
        yield* waitingFor("send /banana");
        const afterFirst = holdAt((label) => label.startsWith("completed"));
        yield* turns.send(SESSION, { text: "/banana" });
        yield* until(() => afterFirst.reached);

        // The turn's result came, but Claude Code hasn't run the command yet.
        assert.include(processes[0]?.log ?? [], `result "SLASHDONE"`);
        assert.isTrue((yield* turns.turn(SESSION))?.running);
        assert.deepStrictEqual(finished, []);

        afterFirst.release();
        yield* until(() => processes[0]?.waiting === "end");
        yield* idle(turns);
        assert.include(processes[0]?.log ?? [], `result "BANANA2"`);
        assert.deepStrictEqual(finished, [SESSION]);
      }),
  );

  it.effect(
    "stops a turn and keeps the process, which then runs the message it already had",
    () =>
      Effect.gen(function* () {
        fresh(stop);
        const turns = yield* Turns;
        yield* turns.close(SESSION);
        const finished: Array<string> = [];
        yield* turns.finished.pipe(
          Stream.runForEach((turn) =>
            Effect.sync(() => finished.push(turn.id)),
          ),
          Effect.forkScoped,
        );
        yield* tick;
        yield* turns.send(SESSION, {
          text: "Run `sleep 20` with Bash, then say DONE",
        });
        yield* waitingFor("send Also say KIWI at the very end");
        yield* turns.send(SESSION, { text: "Also say KIWI at the very end" });
        yield* waitingFor("interrupt");

        const before = Date.now();
        yield* turns.interrupt(SESSION);
        assert.isBelow(Date.now() - before, 1_000);
        const [process] = processes;
        assert.include(process?.log ?? [], "interrupt");
        // Claude Code had the message, so it runs next, in the same process.
        const after = yield* turns.turn(SESSION);
        assert.isTrue(after?.running);
        assert.isUndefined(after?.error);

        yield* waitingFor("send Reply only AFTER");
        yield* turns.send(SESSION, { text: "Reply only AFTER" });
        yield* until(() => process?.waiting === "end");
        yield* idle(turns);
        assert.include(process?.log ?? [], `result "DONE\\nKIWI"`);
        assert.strictEqual(processes.length, 1);
        assert.isFalse(process?.closed);
        assert.isUndefined((yield* turns.turn(SESSION))?.error);
        // Only the turn that wasn't stopped finished.
        assert.deepStrictEqual(finished, [SESSION]);
      }),
  );

  it.effect("takes back a message Claude Code doesn't have yet", () =>
    Effect.gen(function* () {
      fresh({
        steps: [
          { send: "first" },
          { type: "command_lifecycle", command_uuid: "$1", state: "started" },
          init,
          reply("one"),
          result("one", ["$1"]),
        ],
      });
      const turns = yield* Turns;
      const { promise, resolve: open } = Promise.withResolvers<void>();
      opening = promise;
      yield* turns.send(OTHER, { text: "first" });
      yield* turns.send(OTHER, { text: "second" });

      // The process is still opening, so neither has reached Claude Code. Only the second, sent
      // into the running turn, shows as queued.
      const queued = (yield* turns.turn(OTHER))?.queued ?? [];
      assert.deepStrictEqual(
        queued.map(({ text, delivered }) => ({ text, delivered })),
        [{ text: "second", delivered: false }],
      );
      yield* turns.unqueue(OTHER, queued[0]?.id ?? "");
      assert.isUndefined((yield* turns.turn(OTHER))?.queued);

      opening = Promise.resolve();
      open();
      yield* until(() => processes[0]?.waiting === "end");
      yield* idle(turns, OTHER);
      assert.deepStrictEqual(
        processes[0]?.received.map((r) => r.text),
        ["first"],
      );
    }),
  );
});

// On the test clock, so the idle timeout can pass at once.
layer(TestTurns)("A Session's idle process", (it) => {
  it.effect(
    "closes after the idle timeout, and the next message resumes the Session in a new one",
    () =>
      Effect.gen(function* () {
        fresh(
          {
            steps: [{ send: "one" }, init, reply("one"), result("one", ["$1"])],
          },
          {
            steps: [{ send: "two" }, init, reply("two"), result("two", ["$1"])],
          },
        );
        // Long after the Session was last written.
        yield* TestClock.setTime(Date.now());
        const turns = yield* Turns;
        yield* turns.send(SESSION, { text: "one" });
        yield* until(() => processes[0]?.waiting === "end");
        yield* idle(turns);

        yield* TestClock.adjust(
          Duration.subtract(IDLE_TIMEOUT, Duration.seconds(1)),
        );
        assert.isFalse(processes[0]?.closed);
        yield* TestClock.adjust("1 second");
        yield* until(() => processes[0]?.closed === true);

        yield* turns.send(SESSION, { text: "two" });
        yield* until(() => processes[1]?.waiting === "end");
        yield* idle(turns);
        assert.strictEqual(processes[1]?.options.resume, SESSION);
        assert.deepStrictEqual(
          processes.map((p) => p.received.map((r) => r.text)),
          [["one"], ["two"]],
        );
      }),
  );

  it.effect("stays open while a turn runs, however long", () =>
    Effect.gen(function* () {
      fresh({
        steps: [
          { send: "work" },
          init,
          { send: "more" },
          reply("done"),
          result("done", ["$1", "$2"]),
        ],
      });
      const turns = yield* Turns;
      yield* turns.close(SESSION);
      yield* turns.send(SESSION, { text: "work" });
      yield* waitingFor("send more");
      yield* TestClock.adjust(Duration.sum(IDLE_TIMEOUT, Duration.minutes(1)));
      yield* tick;
      assert.isFalse(processes[0]?.closed);
      yield* turns.send(SESSION, { text: "more" });
      yield* until(() => processes[0]?.waiting === "end");
      yield* idle(turns);
      assert.isFalse(processes[0]?.closed);
    }),
  );
});

// Through Fern's API, as the composer and dev.ts reach it.
const makeClient = HttpApiTest.groups(FernApi, ["sessions"]);
const SessionsApi = Layer.mergeAll(
  UnusedRounds,
  UnusedTranscripts,
  NoEscapes,
  UnusedFlows,
  UnusedCommands,
  UnusedWorkspace,
  UnusedWalkthroughs,
  UnusedWorktreeCleanup,
  UnusedSubagents,
  UnusedVerifySlots,
  TestTurns,
);
layer(
  Layer.mergeAll(
    HandlersNoDeps.pipe(Layer.provide(SessionsApi)),
    HttpServer.layerServices,
  ),
  { excludeTestServices: true },
)("Sending through Fern's API", (it) => {
  it.effect(
    "sends mid-turn, refuses to take back a delivered message, and reports the turn running until it ends",
    () =>
      Effect.gen(function* () {
        fresh(midTurn);
        const client = yield* makeClient;
        yield* client.sessions.send({
          params: { id: SESSION },
          payload: {
            text: "Run `sleep 2` with Bash three separate times, one call each, then say FINISHED",
          },
        });
        yield* waitingFor("send Also say BANANA at the very end");
        assert.deepStrictEqual(yield* client.sessions.running(), [SESSION]);

        const toolResult = holdAt((label) => label === "user");
        yield* client.sessions.send({
          params: { id: SESSION },
          payload: { text: "Also say BANANA at the very end" },
        });
        yield* until(() => toolResult.reached);
        const item = processes[0]?.received[1]?.uuid ?? "";
        const refused = yield* client.sessions
          .unqueue({ params: { id: SESSION, item } })
          .pipe(Effect.flip);
        assert.strictEqual(refused._tag, "MessageDelivered");

        toolResult.release();
        yield* waitingFor("send Reply only PING2");
        assert.deepStrictEqual(yield* client.sessions.running(), []);
        assert.include(processes[0]?.log ?? [], `result "FINISHED\\nBANANA"`);
      }),
  );
});
