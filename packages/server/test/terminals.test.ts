import { assert, it, layer } from "@effect/vitest";
import type { TerminalEvent } from "@repo/api";
import { Context, Effect, Exit, Layer, Queue, Scope, Stream } from "effect";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalShell, Terminals } from "../src/terminal/Terminals";

// A Session's terminal on a real PTY, running /bin/sh in a temp folder.

const SIZE = { cols: 80, rows: 24 };

const Shell = Layer.succeed(TerminalShell, { file: "/bin/sh", args: [] });
const TestTerminals = Terminals.layer.pipe(Layer.provide(Shell));

const folder = () => mkdtempSync(join(tmpdir(), "fern-terminal-"));

// A viewer of a Session's terminal: everything it has been sent so far, and whether the stream
// has ended.
const watch = Effect.fn(function* (
  terminals: Terminals["Service"],
  sessionId: string,
  root: string,
) {
  const events = yield* Queue.unbounded<TerminalEvent>();
  const seen: Array<TerminalEvent> = [];
  yield* terminals.open(sessionId, root, SIZE).pipe(
    Stream.runForEach((event) =>
      Effect.sync(() => seen.push(event)).pipe(
        Effect.andThen(Queue.offer(events, event)),
      ),
    ),
    Effect.forkScoped,
  );
  const output = () =>
    seen.flatMap((e) => (e._tag === "TerminalOutput" ? [e.data] : [])).join("");
  // Waits until the output so far holds `text`.
  const until = (text: string | RegExp) =>
    Effect.gen(function* () {
      for (let i = 0; i < 300; i++) {
        const out = output();
        if (typeof text === "string" ? out.includes(text) : text.test(out))
          return out;
        yield* Effect.sleep("10 millis");
      }
      return assert.fail(
        `never printed ${String(text)}; got ${JSON.stringify(output())}`,
      );
    });
  // The shell has started once it prompts.
  yield* Queue.take(events);
  return { sessionId, seen, output, until };
});

// Whether a process with the pid is still running.
const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

type Viewer = Effect.Success<ReturnType<typeof watch>>;

// The pid of the shell a viewer is watching.
const shellPid = Effect.fn(function* (
  terminals: Terminals["Service"],
  viewer: Viewer,
) {
  yield* terminals.write(viewer.sessionId, "echo pid=$$\r");
  const out = yield* viewer.until(/pid=(\d+)\r/);
  return Number(/pid=(\d+)\r/.exec(out)?.[1]);
});

layer(TestTerminals, { excludeTestServices: true })(
  "A Session's terminal",
  (test) => {
    test.effect("runs a shell in the Session's folder", () =>
      Effect.gen(function* () {
        const terminals = yield* Terminals;
        const root = folder();
        const viewer = yield* watch(terminals, "session-a", root);
        yield* terminals.write("session-a", "echo $PWD\r");
        yield* viewer.until(`${root}\r`);
      }),
    );

    test.effect("gives each Session its own shell", () =>
      Effect.gen(function* () {
        const terminals = yield* Terminals;
        const [one, two] = [folder(), folder()];
        const first = yield* watch(terminals, "session-one", one);
        const second = yield* watch(terminals, "session-two", two);
        yield* terminals.write("session-one", "echo $PWD\r");
        yield* terminals.write("session-two", "echo $PWD\r");
        yield* first.until(`${one}\r`);
        yield* second.until(`${two}\r`);
        assert.notInclude(first.output(), two);
        assert.notInclude(second.output(), one);
      }),
    );

    test.effect("ends the stream with the shell's exit code", () =>
      Effect.gen(function* () {
        const terminals = yield* Terminals;
        const viewer = yield* watch(terminals, "session-exit", folder());
        yield* terminals.write("session-exit", "exit 3\r");
        for (
          let i = 0;
          i < 300 && viewer.seen.at(-1)?._tag !== "TerminalExit";
          i++
        )
          yield* Effect.sleep("10 millis");
        assert.deepStrictEqual(viewer.seen.at(-1), {
          _tag: "TerminalExit",
          code: 3,
        });
      }),
    );
  },
);

it.live("closing the service's scope kills every shell", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(TestTerminals, scope);
    const terminals = Context.get(context, Terminals);
    const pids = yield* Effect.gen(function* () {
      const a = yield* watch(terminals, "session-a", folder());
      const b = yield* watch(terminals, "session-b", folder());
      return [yield* shellPid(terminals, a), yield* shellPid(terminals, b)];
    }).pipe(Effect.scoped);
    // The viewers are gone, but the shells run on.
    assert.isTrue(pids.every(isAlive));
    yield* Scope.close(scope, Exit.void);
    assert.deepStrictEqual(pids.map(isAlive), [false, false]);
  }),
);
