import { assert, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { vi } from "vitest";
import { GitError } from "../src/git/Git";
import { Snapshots } from "../src/snapshot/Snapshots";
import { FernTools } from "../src/turn/FernTools";
import { HostedSessions } from "../src/turn/HostedSessions";
import { Turns } from "../src/turn/Turns";
import { Worktrees } from "../src/worktree/Worktrees";

const SESSION = "6f0c4a52-7d2e-4f0e-9a36-1f8b2c9d4e11";

// Each turn Claude Code would run, in the order they start: what it was sent, the options it was
// run with, and how to end it.
interface FakeTurn {
  readonly text: string;
  readonly options: Record<string, unknown>;
  readonly finish: () => void;
}
const started: Array<FakeTurn> = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionInfo: () =>
    Promise.resolve({ sessionId: SESSION, lastModified: 0, cwd: "/repo" }),
  query: ({
    prompt,
    options,
  }: {
    prompt: AsyncIterable<{ message: { content: Array<{ text?: string }> } }>;
    options: Record<string, unknown>;
  }) => {
    const { promise: ended, resolve: finish } = Promise.withResolvers<void>();
    async function* events() {
      const first = await prompt[Symbol.asyncIterator]().next();
      const text = first.done
        ? ""
        : (first.value.message.content.find((part) => part.text)?.text ?? "");
      started.push({ text, options, finish });
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
// SESSION is an External Session; the ones Fern starts are Hosted.
const hostedIds = new Set<string>();
const KnownSessions = Layer.succeed(
  HostedSessions,
  HostedSessions.of({
    record: (id) => Effect.sync(() => hostedIds.add(id)),
    worktrees: Effect.succeed([]),
    listed: Effect.succeed([]),
    isProject: () => Effect.succeed(true),
    isHosted: (id) => Effect.sync(() => hostedIds.has(id)),
  }),
);
// Makes a pretend worktree for each Session started, so starting needs no git.
const FakeWorktrees = Layer.succeed(
  Worktrees,
  Worktrees.of({
    create: (root) =>
      Effect.succeed({
        projectRoot: root,
        branch: "work",
        base: "0".repeat(40),
        path: "/worktrees/work",
        cwd: "/worktrees/work",
      }),
  }),
);
// Stands in for the Flow: a tool server and steering named after the Session they're for.
const TestTools = Layer.succeed(
  FernTools,
  FernTools.of({
    register: () => Effect.void,
    options: (id) =>
      Effect.succeed({
        mcpServers: { fern: { command: `fern-tools-${id}` } },
        allowedTools: [`mcp__fern__tool_${id}`],
        appendSystemPrompt: `Follow the Flow in ${id}.`,
      }),
  }),
);
const TestTurns = Turns.layer.pipe(
  Layer.provide([NoSnapshots, KnownSessions, TestTools, FakeWorktrees]),
);

// What a Hosted Session's turns are run with besides the message.
const hostedOptions = (id: string) => ({
  mcpServers: { fern: { command: `fern-tools-${id}` } },
  allowedTools: [`mcp__fern__tool_${id}`],
  systemPrompt: {
    type: "preset",
    preset: "claude_code",
    append: `Follow the Flow in ${id}.`,
  },
});

const tick = Effect.promise(
  () => new Promise((resolve) => setTimeout(resolve, 5)),
);

// Gives the turn's fiber moments to move until the condition holds.
const until = (condition: () => boolean) =>
  Effect.gen(function* () {
    for (let i = 0; i < 200 && !condition(); i++) yield* tick;
  });

// Waits for the Session to go idle.
const idle = (turns: Turns["Service"], id = SESSION) =>
  Effect.gen(function* () {
    for (let i = 0; i < 200; i++) {
      if ((yield* turns.turn(id))?.running === false) return;
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

  it.effect(
    "runs every turn of a Hosted Session with Fern's tools and steering",
    () =>
      Effect.gen(function* () {
        started.length = 0;
        const turns = yield* Turns;
        const id = yield* turns.start("/repo", message("first"));
        yield* until(() => started.length === 1);
        yield* turns.send(id, message("queued"));
        started[0]?.finish();
        yield* until(() => started.length === 2);
        started[1]?.finish();
        yield* idle(turns, id);

        // Resumed later, once the queue has run.
        yield* turns.send(id, message("resumed"));
        yield* until(() => started.length === 3);
        started[2]?.finish();
        yield* idle(turns, id);

        assert.deepStrictEqual(
          started.map((turn) => turn.text),
          ["/grill-with-docs first", "queued", "resumed"],
        );
        for (const turn of started)
          assert.deepInclude(turn.options, hostedOptions(id));
      }),
  );

  it.effect("runs an External Session's turns with nothing extra", () =>
    Effect.gen(function* () {
      started.length = 0;
      const turns = yield* Turns;
      yield* turns.send(SESSION, message("hello"));
      yield* until(() => started.length === 1);
      started[0]?.finish();
      yield* idle(turns);
      assert.notProperty(started[0]?.options, "mcpServers");
      assert.notProperty(started[0]?.options, "systemPrompt");
    }),
  );
});

// Until the Flow engine supplies its own, a Hosted Session is only told about the Flow.
layer(
  Turns.layer.pipe(
    Layer.provide([NoSnapshots, KnownSessions, FernTools.layer, FakeWorktrees]),
  ),
  { excludeTestServices: true },
)("Turns with the default Fern tools", (it) => {
  it.effect(
    "describes the Flow to a Hosted Session and offers it no tools",
    () =>
      Effect.gen(function* () {
        started.length = 0;
        const turns = yield* Turns;
        const id = yield* turns.start("/repo", message("first"));
        yield* until(() => started.length === 1);
        started[0]?.finish();
        yield* idle(turns, id);

        const options = started[0]?.options;
        assert.deepStrictEqual(options?.mcpServers, {});
        assert.deepInclude(options?.systemPrompt, {
          type: "preset",
          preset: "claude_code",
        });
        assert.match(
          JSON.stringify(options?.systemPrompt),
          /Grill.*Spec.*Implement.*Retro/,
        );
      }),
  );
});
