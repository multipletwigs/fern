import { assert, it, layer } from "@effect/vitest";
import type { TerminalEvent } from "@repo/api";
import { Context, Effect, Exit, Layer, Queue, Scope, Stream } from "effect";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TerminalExitScrollback,
  TerminalScrollback,
  TerminalShell,
  Terminals,
} from "../src/terminal/Terminals";

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
    seen.flatMap((e) => (e._tag === "TerminalExit" ? [] : [e.data])).join("");
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
  // The shell has started once it prompts, or replays what it printed before.
  while (true) {
    const event = yield* Queue.take(events);
    if (event._tag !== "TerminalReplay" || event.data !== "") break;
  }
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

// Waits for the viewer's stream to end with the shell's exit.
const exitOf = Effect.fn(function* (viewer: Viewer) {
  for (let i = 0; i < 300; i++) {
    const last = viewer.seen.at(-1);
    if (last?._tag === "TerminalExit") return last;
    yield* Effect.sleep("10 millis");
  }
  return assert.fail(`never exited; got ${JSON.stringify(viewer.output())}`);
});

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

    test.effect(
      "replays what the shell printed to a viewer who comes back, and keeps the same shell running",
      () =>
        Effect.gen(function* () {
          const terminals = yield* Terminals;
          const root = folder();
          const before = yield* Effect.gen(function* () {
            const viewer = yield* watch(terminals, "session-back", root);
            const pid = yield* shellPid(terminals, viewer);
            // Still counting once the viewer has gone.
            yield* terminals.write(
              "session-back",
              "echo away-start; sleep 0.3; echo away-end\r",
            );
            yield* viewer.until("away-start\r");
            return pid;
          }).pipe(Effect.scoped);
          yield* Effect.sleep("500 millis");

          const viewer = yield* watch(terminals, "session-back", root);
          // The first thing the returning viewer sees is the output from before, as a replay.
          const first = viewer.seen[0];
          assert.strictEqual(first?._tag, "TerminalReplay");
          assert.include(
            first?._tag === "TerminalReplay" ? first.data : "",
            "away-end\r",
          );
          assert.strictEqual(yield* shellPid(terminals, viewer), before);
        }),
    );

    test.effect("ends the stream with the shell's exit code", () =>
      Effect.gen(function* () {
        const terminals = yield* Terminals;
        const viewer = yield* watch(terminals, "session-exit", folder());
        yield* terminals.write("session-exit", "exit 3\r");
        assert.deepStrictEqual(yield* exitOf(viewer), {
          _tag: "TerminalExit",
          code: 3,
        });
      }),
    );

    test.effect(
      "shows a viewer who comes back after the shell exited what it printed and how it exited",
      () =>
        Effect.gen(function* () {
          const terminals = yield* Terminals;
          const root = folder();
          yield* Effect.gen(function* () {
            const viewer = yield* watch(terminals, "session-gone", root);
            yield* terminals.write("session-gone", "echo last-words; exit 4\r");
            yield* exitOf(viewer);
          }).pipe(Effect.scoped);

          const viewer = yield* watch(terminals, "session-gone", root);
          assert.deepStrictEqual(yield* exitOf(viewer), {
            _tag: "TerminalExit",
            code: 4,
          });
          assert.include(viewer.output(), "last-words\r");
        }),
    );

    test.effect(
      "killing a Session's shell ends it, and the next viewer gets a fresh one",
      () =>
        Effect.gen(function* () {
          const terminals = yield* Terminals;
          const root = folder();
          const viewer = yield* watch(terminals, "session-kill", root);
          yield* terminals.write("session-kill", "echo before-kill\r");
          yield* viewer.until("before-kill\r");
          const pid = yield* shellPid(terminals, viewer);

          yield* terminals.kill("session-kill");

          assert.isFalse(isAlive(pid));
          assert.strictEqual((yield* exitOf(viewer))._tag, "TerminalExit");
          const fresh = yield* watch(terminals, "session-kill", root);
          assert.notInclude(fresh.output(), "before-kill");
          assert.notStrictEqual(yield* shellPid(terminals, fresh), pid);
        }),
    );

    test.effect(
      "starts a fresh shell in the Session's new folder once its folder changes",
      () =>
        Effect.gen(function* () {
          const terminals = yield* Terminals;
          const [before, after] = [folder(), folder()];
          const old = yield* watch(terminals, "session-moved", before);
          const pid = yield* shellPid(terminals, old);

          const moved = yield* watch(terminals, "session-moved", after);
          yield* terminals.write("session-moved", "echo $PWD\r");
          yield* moved.until(`${after}\r`);
          assert.notStrictEqual(yield* shellPid(terminals, moved), pid);
          assert.isFalse(isAlive(pid));
          assert.strictEqual((yield* exitOf(old))._tag, "TerminalExit");
        }),
    );

    test.effect(
      "killing an exited shell lets the next viewer start a fresh one",
      () =>
        Effect.gen(function* () {
          const terminals = yield* Terminals;
          const root = folder();
          const viewer = yield* watch(terminals, "session-restart", root);
          yield* terminals.write("session-restart", "exit 1\r");
          yield* exitOf(viewer);

          yield* terminals.kill("session-restart");

          const fresh = yield* watch(terminals, "session-restart", root);
          yield* terminals.write("session-restart", "echo $PWD\r");
          yield* fresh.until(`${root}\r`);
          assert.isFalse(fresh.seen.some((e) => e._tag === "TerminalExit"));
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

layer(
  Terminals.layer.pipe(
    Layer.provide([Shell, Layer.succeed(TerminalScrollback, 1000)]),
  ),
  { excludeTestServices: true },
)("A Session's terminal with a short scrollback", (test) => {
  test.effect("keeps only the latest output for a viewer who comes back", () =>
    Effect.gen(function* () {
      const terminals = yield* Terminals;
      const root = folder();
      yield* Effect.gen(function* () {
        const viewer = yield* watch(terminals, "session-long", root);
        yield* terminals.write(
          "session-long",
          "i=0; while [ $i -lt 400 ]; do i=$((i+1)); echo line-$i; done\r",
        );
        yield* viewer.until("line-400\r");
      }).pipe(Effect.scoped);

      const viewer = yield* watch(terminals, "session-long", root);
      const replay = viewer.output();
      assert.include(replay, "line-400\r");
      assert.notInclude(replay, "line-1\r");
      assert.isAtMost(replay.length, 1000);
    }),
  );
});

layer(
  Terminals.layer.pipe(
    Layer.provide([
      Shell,
      Layer.succeed(TerminalScrollback, 1000),
      Layer.succeed(TerminalExitScrollback, 200),
    ]),
  ),
  { excludeTestServices: true },
)("A Session's terminal once its shell has exited", (test) => {
  test.effect("keeps only its last lines, to show how it ended", () =>
    Effect.gen(function* () {
      const terminals = yield* Terminals;
      const root = folder();
      yield* Effect.gen(function* () {
        const viewer = yield* watch(terminals, "session-ended", root);
        yield* terminals.write(
          "session-ended",
          "i=0; while [ $i -lt 400 ]; do i=$((i+1)); echo line-$i; done; exit 5\r",
        );
        yield* exitOf(viewer);
      }).pipe(Effect.scoped);

      const viewer = yield* watch(terminals, "session-ended", root);
      assert.deepStrictEqual(yield* exitOf(viewer), {
        _tag: "TerminalExit",
        code: 5,
      });
      const replay = viewer.output();
      assert.include(replay, "line-400\r");
      assert.isAtMost(replay.length, 200);
    }),
  );
});
