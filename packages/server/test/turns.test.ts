import { assert, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { vi } from "vitest";
import { GitError } from "../src/git/Git";
import { Snapshots } from "../src/snapshot/Snapshots";
import { HostedSessions } from "../src/turn/HostedSessions";
import { Turns } from "../src/turn/Turns";
import { UnusedWorktrees } from "./stubs";

const SESSION = "6f0c4a52-7d2e-4f0e-9a36-1f8b2c9d4e11";

// Each turn Claude Code would run, in the order they start: what it was sent, and how to end it.
interface FakeTurn {
  readonly text: string;
  readonly finish: () => void;
}
const started: Array<FakeTurn> = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionInfo: () =>
    Promise.resolve({ sessionId: SESSION, lastModified: 0, cwd: "/repo" }),
  query: ({
    prompt,
  }: {
    prompt: AsyncIterable<{ message: { content: Array<{ text?: string }> } }>;
  }) => {
    const { promise: ended, resolve: finish } = Promise.withResolvers<void>();
    async function* events() {
      const first = await prompt[Symbol.asyncIterator]().next();
      const text = first.done
        ? ""
        : (first.value.message.content.find((part) => part.text)?.text ?? "");
      started.push({ text, finish });
      yield { type: "system", subtype: "init", model: "claude-test" };
      await ended;
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "",
        modelUsage: { "claude-test": { contextWindow: 1_000 } },
      };
    }
    return Object.assign(events(), {
      interrupt: () => {
        finish();
        return Promise.resolve();
      },
      close: () => {},
    });
  },
}));

const NoSnapshots = Layer.succeed(
  Snapshots,
  // Only `repo` is reached, and a folder outside git just has no Walkthroughs.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  { repo: () => Effect.fail(new GitError({ message: "not a repo" })) } as never,
);
const KnownSessions = Layer.succeed(
  HostedSessions,
  HostedSessions.of({
    record: () => Effect.void,
    worktrees: Effect.succeed([]),
    listed: Effect.succeed([]),
    isProject: () => Effect.succeed(true),
  }),
);
const TestTurns = Turns.layer.pipe(
  Layer.provide([NoSnapshots, KnownSessions, UnusedWorktrees]),
);

const tick = Effect.promise(
  () => new Promise((resolve) => setTimeout(resolve, 5)),
);

// Gives the turn's fiber moments to move until the condition holds.
const until = (condition: () => boolean) =>
  Effect.gen(function* () {
    for (let i = 0; i < 200 && !condition(); i++) yield* tick;
  });

// Waits for the Session to go idle.
const idle = (turns: Turns["Service"]) =>
  Effect.gen(function* () {
    for (let i = 0; i < 200; i++) {
      if ((yield* turns.turn(SESSION))?.running === false) return;
      yield* tick;
    }
  });

const message = (text: string) => ({ text });

// One set of Turns for the file: each test leaves the Session idle for the next.
layer(TestTurns, { excludeTestServices: true })("Turns", (it) => {
  it.effect(
    "queues messages behind the running turn and runs them in order",
    () =>
      Effect.gen(function* () {
        started.length = 0;
        const turns = yield* Turns;
        yield* turns.send(SESSION, message("first"));
        yield* until(() => started.length === 1);

        yield* turns.send(SESSION, message("second"));
        yield* turns.send(SESSION, message("third"));
        const queued = (yield* turns.turn(SESSION))?.queued ?? [];
        assert.deepStrictEqual(
          queued.map((q) => q.text),
          ["second", "third"],
        );

        // The third is taken back before it runs.
        const third = queued[1];
        if (third) yield* turns.unqueue(SESSION, third.id);

        started[0]?.finish();
        yield* until(() => started.length === 2);
        const between = yield* turns.turn(SESSION);
        assert.strictEqual(started[1]?.text, "second");
        assert.isTrue(between?.running);
        assert.isUndefined(between?.queued);

        started[1]?.finish();
        yield* idle(turns);
        const after = yield* turns.turn(SESSION);
        assert.isFalse(after?.running);
        assert.strictEqual(after?.contextWindow, 1_000);
        assert.strictEqual(started.length, 2);
      }),
  );

  it.effect("drops the queue when the developer stops the turn", () =>
    Effect.gen(function* () {
      started.length = 0;
      const turns = yield* Turns;
      yield* turns.send(SESSION, message("first"));
      yield* until(() => started.length === 1);
      yield* turns.send(SESSION, message("second"));

      yield* turns.interrupt(SESSION);
      const after = yield* turns.turn(SESSION);
      assert.isFalse(after?.running);
      assert.isUndefined(after?.queued);
      // Nothing queued starts after the stop.
      for (let i = 0; i < 10; i++) yield* tick;
      assert.strictEqual(started.length, 1);
    }),
  );
});
