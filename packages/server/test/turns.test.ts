import { assert, layer } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import { vi } from "vitest";
import { GitError } from "../src/git/Git";
import { Snapshots } from "../src/snapshot/Snapshots";
import { FernTools } from "../src/turn/FernTools";
import { HostedSessions } from "../src/turn/HostedSessions";
import { Turns } from "../src/turn/Turns";
import { Worktrees } from "../src/worktree/Worktrees";
import type { FakeTurn } from "./fakeClaude";

const SESSION = "6f0c4a52-7d2e-4f0e-9a36-1f8b2c9d4e11";

// Each turn Claude Code runs, in the order they start, with how to end it.
const started: Array<FakeTurn & { readonly finish: () => void }> = [];
// Each process opened, by the options it was opened with.
const opened: Array<Record<string, unknown>> = [];

vi.mock("@anthropic-ai/claude-agent-sdk", async () => {
  const { scriptedQuery } = await import("./fakeClaude");
  const run = scriptedQuery((turn) => {
    const { promise, resolve } = Promise.withResolvers<void>();
    started.push({ ...turn, finish: resolve });
    return promise;
  });
  return {
    getSessionInfo: () =>
      Promise.resolve({ sessionId: SESSION, lastModified: 0, cwd: "/repo" }),
    query: (args: Parameters<typeof run>[0]) => {
      opened.push(args.options);
      return run(args);
    },
  };
});

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
    archive: () => Effect.die("unused"),
    worktrees: Effect.succeed([]),
    sessions: Effect.succeed([]),
    session: () => Effect.undefined,
    changes: Stream.never,
    listed: Effect.succeed([]),
    isProject: () => Effect.succeed(true),
    isHosted: (id) => Effect.sync(() => hostedIds.has(id)),
    projectOf: () => Effect.succeed("/repo"),
  }),
);
// Makes a pretend worktree for each Session started, so starting needs no git.
const FakeWorktrees = Layer.succeed(
  Worktrees,
  Worktrees.of({
    branchable: () => Effect.succeed(true),
    create: (root) =>
      Effect.succeed({
        projectRoot: root,
        branch: "work",
        base: "0".repeat(40),
        path: "/worktrees/work",
        cwd: "/worktrees/work",
      }),
    isMerged: () => Effect.die("unused"),
    isDirty: () => Effect.die("unused"),
    remove: () => Effect.die("unused"),
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

// What a Hosted Session's process is opened with besides its messages.
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

// Gives the Session's fibers moments to move until the condition holds.
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

const fresh = Effect.gen(function* () {
  yield* (yield* Turns).close(SESSION);
  started.length = 0;
  opened.length = 0;
});

// One set of Turns for the file: each test leaves the Session idle for the next.
layer(TestTurns, { excludeTestServices: true })("Turns", (it) => {
  it.effect(
    "sends messages into the running turn, and the agent takes each in before the turn ends",
    () =>
      Effect.gen(function* () {
        yield* fresh;
        const turns = yield* Turns;
        yield* turns.send(SESSION, message("first"));
        yield* until(() => started.length === 1);
        yield* turns.send(SESSION, message("second"));
        assert.deepStrictEqual(
          (yield* turns.turn(SESSION))?.queued?.map((q) => q.text),
          ["second"],
        );

        // This agent takes it in once the first message is answered, as a turn of its own.
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
        assert.strictEqual(opened.length, 1);
      }),
  );

  it.effect(
    "stops the turn, dropping only what Claude Code doesn't have, and keeps the process",
    () =>
      Effect.gen(function* () {
        yield* fresh;
        const turns = yield* Turns;
        yield* turns.send(SESSION, message("first"));
        yield* until(() => started.length === 1);

        yield* turns.interrupt(SESSION);
        const after = yield* turns.turn(SESSION);
        assert.isFalse(after?.running);
        assert.isUndefined(after?.error);

        yield* turns.send(SESSION, message("next"));
        yield* until(() => started.length === 2);
        started[1]?.finish();
        yield* idle(turns);
        assert.strictEqual(started[1]?.text, "next");
        assert.strictEqual(opened.length, 1);
      }),
  );

  it.effect(
    "opens a Hosted Session's process with Fern's tools and steering, and resumes it with them",
    () =>
      Effect.gen(function* () {
        yield* fresh;
        const turns = yield* Turns;
        const id = yield* turns.start("/repo", message("first"));
        yield* until(() => started.length === 1);
        yield* turns.send(id, message("into the turn"));
        started[0]?.finish();
        yield* until(() => started.length === 2);
        started[1]?.finish();
        yield* idle(turns, id);

        // Closed, as on archive, then resumed.
        yield* turns.close(id);
        yield* turns.send(id, message("resumed"));
        yield* until(() => started.length === 3);
        started[2]?.finish();
        yield* idle(turns, id);

        assert.deepStrictEqual(
          started.map((turn) => turn.text),
          ["/grill-with-docs first", "into the turn", "resumed"],
        );
        assert.strictEqual(opened.length, 2);
        assert.deepInclude(opened[0], { sessionId: id, ...hostedOptions(id) });
        assert.deepInclude(opened[1], { resume: id, ...hostedOptions(id) });
      }),
  );

  it.effect("opens an External Session's process with nothing extra", () =>
    Effect.gen(function* () {
      yield* fresh;
      const turns = yield* Turns;
      yield* turns.send(SESSION, message("hello"));
      yield* until(() => started.length === 1);
      started[0]?.finish();
      yield* idle(turns);
      assert.notProperty(opened[0], "mcpServers");
      assert.notProperty(opened[0], "systemPrompt");
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
        opened.length = 0;
        const turns = yield* Turns;
        const id = yield* turns.start("/repo", message("first"));
        yield* until(() => started.length === 1);
        started[0]?.finish();
        yield* idle(turns, id);

        const options = opened[0];
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
