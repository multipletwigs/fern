import { assert, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { vi } from "vitest";
import { GitError } from "../src/git/Git";
import { Snapshots } from "../src/snapshot/Snapshots";
import { FernTools } from "../src/turn/FernTools";
import { HostedSessions } from "../src/turn/HostedSessions";
import { Turns } from "../src/turn/Turns";
import { Worktrees } from "../src/worktree/Worktrees";

// Replays message sequences captured from the real Claude Code CLI (0.3.296, Haiku), trimmed to the
// fields Turns reads. Each query Turns opens plays the next script; a `wait` step holds the script
// until the test releases it, the way a background subagent's work takes time.

const SESSION = "2c9ad25b-9de1-43f3-a556-86a845165b20";

type Step = Record<string, unknown> | "wait";
const scripts: Array<ReadonlyArray<Step>> = [];
// What happened, in order: the text each query was sent, each message's label as Claude Code
// sends it, and each close.
const log: Array<string> = [];
let release: () => void = () => {};

const label = (step: Record<string, unknown>) =>
  step.type === "result"
    ? `result ${JSON.stringify(step.result)}`
    : step.type === "assistant"
      ? "assistant"
      : String(step.subtype ?? step.type);

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionInfo: () =>
    Promise.resolve({ sessionId: SESSION, lastModified: 0, cwd: "/repo" }),
  query: ({
    prompt,
  }: {
    prompt: AsyncIterable<{ message: { content: Array<{ text?: string }> } }>;
  }) => {
    let closed = false;
    const script = scripts.shift() ?? [];
    async function* events() {
      const first = await prompt[Symbol.asyncIterator]().next();
      if (!first.done)
        log.push(`sent ${first.value.message.content[0]?.text ?? ""}`);
      for (const step of script) {
        if (step === "wait") {
          const { promise, resolve } = Promise.withResolvers<void>();
          release = resolve;
          await promise;
          continue;
        }
        if (closed) return;
        log.push(label(step));
        yield step;
      }
    }
    return Object.assign(events(), {
      // Claude Code stops the turn, and its background tasks, with an error result.
      interrupt: () => {
        release();
        return Promise.resolve();
      },
      close: () => {
        closed = true;
        log.push("close");
      },
    });
  },
}));

const init = { type: "system", subtype: "init", model: "claude-haiku" };
const assistant = (text: string) => ({
  type: "assistant",
  parent_tool_use_id: null,
  message: { role: "assistant", content: [{ type: "text", text }] },
});
const result = (text: string, turns: number) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: turns,
  result: text,
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
  init,
  { type: "assistant", message: { content: [{ type: "tool_use" }] } },
  tasksChanged([subagent]),
  { type: "system", subtype: "task_started", task_id: subagent.task_id },
  assistant("launched"),
  result("launched", 2),
  "wait",
  { type: "system", subtype: "task_progress", task_id: subagent.task_id },
  notified("completed"),
  tasksChanged([]),
  init,
  assistant("The background subagent finished."),
  result("The background subagent finished.", 1),
];

// Resuming a Session whose subagent was killed: the stopped notification gets an empty result,
// with no model call, before Claude Code answers the message.
const resumeAfterKilledSubagent: ReadonlyArray<Step> = [
  notified("stopped"),
  init,
  result("", 0),
  init,
  assistant("pong"),
  result("pong", 1),
];

const reply = (text: string): ReadonlyArray<Step> => [
  init,
  assistant(text),
  result(text, 1),
];

const NoSnapshots = Layer.succeed(
  Snapshots,
  // Only `repo` is reached, and a folder outside git just has no Walkthroughs.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  { repo: () => Effect.fail(new GitError({ message: "not a repo" })) } as never,
);
const TestTurns = Turns.layer.pipe(
  Layer.provide([
    NoSnapshots,
    Layer.succeed(
      HostedSessions,
      HostedSessions.of({
        record: () => Effect.void,
        worktrees: Effect.succeed([]),
        listed: Effect.succeed([]),
        isProject: () => Effect.succeed(true),
        isHosted: () => Effect.succeed(false),
      }),
    ),
    Layer.succeed(
      FernTools,
      FernTools.of({
        options: () =>
          Effect.succeed({ mcpServers: {}, appendSystemPrompt: "" }),
      }),
    ),
    Layer.succeed(
      Worktrees,
      Worktrees.of({ create: () => Effect.die("unused") }),
    ),
  ]),
);

const tick = Effect.promise(
  () => new Promise((resolve) => setTimeout(resolve, 5)),
);

// Gives the turn's fiber moments to move until the condition holds.
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

const fresh = (...next: ReadonlyArray<ReadonlyArray<Step>>) => {
  log.length = 0;
  scripts.length = 0;
  scripts.push(...next);
};

layer(TestTurns, { excludeTestServices: true })(
  "Turns with background tasks",
  (it) => {
    it.effect(
      "keeps the turn open until its background subagent's notification turn ends",
      () =>
        Effect.gen(function* () {
          fresh(backgroundSubagent, reply("pong"));
          const turns = yield* Turns;
          yield* turns.send(SESSION, { text: "spawn a background agent" });
          yield* until(() => log.includes(`result "launched"`));
          for (let i = 0; i < 10; i++) yield* tick;

          // The subagent is still working: the Session runs, and a new message waits for it.
          assert.isTrue((yield* turns.turn(SESSION))?.running);
          assert.notInclude(log, "close");
          yield* turns.send(SESSION, { text: "ping" });
          assert.deepStrictEqual(
            (yield* turns.turn(SESSION))?.queued?.map((q) => q.text),
            ["ping"],
          );
          assert.notInclude(log, "sent ping");

          release();
          yield* until(() => log.includes("sent ping"));
          yield* idle(turns);
          assert.deepStrictEqual(log, [
            "sent spawn a background agent",
            "init",
            "assistant",
            "background_tasks_changed",
            "task_started",
            "assistant",
            `result "launched"`,
            "task_progress",
            "task_notification",
            "background_tasks_changed",
            "init",
            "assistant",
            `result "The background subagent finished."`,
            "close",
            "sent ping",
            "init",
            "assistant",
            `result "pong"`,
            "close",
          ]);
        }),
    );

    it.effect(
      "receives the reply after the empty result that follows a resume",
      () =>
        Effect.gen(function* () {
          fresh(resumeAfterKilledSubagent);
          const turns = yield* Turns;
          yield* turns.send(SESSION, { text: "ping" });
          yield* idle(turns);
          assert.deepStrictEqual(log, [
            "sent ping",
            "task_notification",
            "init",
            `result ""`,
            "init",
            "assistant",
            `result "pong"`,
            "close",
          ]);
          assert.isFalse((yield* turns.turn(SESSION))?.running);
        }),
    );

    it.effect(
      "ends at the empty result of a command that answers nothing",
      () =>
        Effect.gen(function* () {
          // What /clear sends.
          fresh([{ type: "conversation_reset" }, init, result("", 0)]);
          const turns = yield* Turns;
          yield* turns.send(SESSION, { text: "/clear" });
          yield* idle(turns);
          assert.deepStrictEqual(log, [
            "sent /clear",
            "conversation_reset",
            "init",
            `result ""`,
            "close",
          ]);
          assert.isFalse((yield* turns.turn(SESSION))?.running);
        }),
    );

    it.effect("stops a turn with a background subagent at once", () =>
      Effect.gen(function* () {
        fresh([
          init,
          tasksChanged([subagent]),
          result("launched", 2),
          "wait",
          {
            type: "result",
            subtype: "error_during_execution",
            is_error: true,
            num_turns: 0,
            errors: [],
            result: "stopped",
            modelUsage: {},
          },
          // With its input open, Claude Code then waits for more.
          "wait",
        ]);
        const turns = yield* Turns;
        yield* turns.send(SESSION, { text: "spawn a background agent" });
        yield* until(() => log.includes(`result "launched"`));
        const before = Date.now();
        yield* turns.interrupt(SESSION);
        assert.isBelow(Date.now() - before, 1_000);
        assert.deepStrictEqual(log.slice(-2), [`result "stopped"`, "close"]);
        assert.isFalse((yield* turns.turn(SESSION))?.running);
      }),
    );
  },
);
