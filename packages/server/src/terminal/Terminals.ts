import {
  TerminalError,
  type TerminalEvent,
  type TerminalSize,
} from "@repo/api";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Queue,
  Scope,
  Semaphore,
  Stream,
  type Cause,
} from "effect";
import { statSync } from "node:fs";
import * as pty from "node-pty";
import { type Scrollback, scrollback } from "./scrollback";

// The shell a terminal runs: the developer's own, as a login shell, so their PATH, aliases and
// prompt are the ones they're used to.
export const TerminalShell = Context.Reference<{
  readonly file: string;
  readonly args: ReadonlyArray<string>;
}>("@repo/server/terminal/TerminalShell", {
  defaultValue: () => ({
    file:
      process.env.SHELL ||
      (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash"),
    args: ["-l"],
  }),
});

// How much of what a shell printed is kept for a viewer who comes back, in UTF-16 code units: about
// 1 MB. The oldest goes first.
export const TerminalScrollback = Context.Reference<number>(
  "@repo/server/terminal/TerminalScrollback",
  { defaultValue: () => 1_000_000 },
);

// How much of what a shell printed is kept once it has exited, to show how it ended: a page or so.
export const TerminalExitScrollback = Context.Reference<number>(
  "@repo/server/terminal/TerminalExitScrollback",
  { defaultValue: () => 16_000 },
);

// How long a shell gets to exit on its hangup before it's killed outright.
const HANGUP_GRACE = "1 second";

type Viewer = Queue.Queue<TerminalEvent, TerminalError | Cause.Done>;

// A Session's shell in its folder, on its PTY, what it has printed lately, and whoever is watching
// it. Kept after the shell exits, with its exit code and its last lines but not its PTY, until
// it's killed.
interface SessionShell {
  readonly root: string;
  // Until the shell exits.
  term: pty.IPty | undefined;
  readonly viewers: Set<Viewer>;
  readonly printed: Scrollback;
  readonly exited: Deferred.Deferred<number>;
  // Closing it stops the shell.
  readonly scope: Scope.Closeable;
  code: number | undefined;
}

const exitEvent = (code: number): TerminalEvent => ({
  _tag: "TerminalExit",
  code,
});

// One shell per Session, on a PTY, in the Session's folder. A shell starts the first time its
// Session's terminal is opened and runs until it exits, it's killed, the Session's folder changes,
// or the service's scope closes, which kills every shell still running. Viewers come and go without
// touching the shell, and each one is first sent what the shell printed before it came.
export class Terminals extends Context.Service<
  Terminals,
  {
    // Streams what the Session's shell has printed lately, as a replay, and goes on to print, then
    // its exit. Starts the shell in `root` at `size` when the Session has none, else attaches to
    // the one it has, at `size`. One in another folder is ended for a fresh one in `root`. A shell
    // that has exited is only replayed, up to its exit, until it's killed.
    readonly open: (
      sessionId: string,
      root: string,
      size: TerminalSize,
    ) => Stream.Stream<TerminalEvent, TerminalError>;
    // Types into the Session's shell. Dropped when none is running.
    readonly write: (sessionId: string, data: string) => Effect.Effect<void>;
    readonly resize: (
      sessionId: string,
      size: TerminalSize,
    ) => Effect.Effect<void>;
    // Ends the Session's shell, if it's still running, and forgets it, so the next `open` starts a
    // fresh one. Viewers see it exit.
    readonly kill: (sessionId: string) => Effect.Effect<void>;
  }
>()("@repo/server/terminal/Terminals") {
  static readonly layer = Layer.effect(
    Terminals,
    Effect.gen(function* () {
      const shell = yield* TerminalShell;
      const limit = yield* TerminalScrollback;
      const exitLimit = yield* TerminalExitScrollback;
      const scope = yield* Effect.scope;
      const shells = new Map<string, SessionShell>();
      // Two viewers opening the same Session at once start one shell, and a kill isn't undone by
      // an open racing it.
      const lock = yield* Semaphore.make(1);

      // Hangs up on the shell, and kills it if it doesn't go.
      const stop = ({ term, exited }: SessionShell) =>
        Effect.gen(function* () {
          if (term === undefined || Deferred.isDoneUnsafe(exited)) return;
          term.kill("SIGHUP");
          const gone = yield* Deferred.await(exited).pipe(
            Effect.timeoutOption(HANGUP_GRACE),
          );
          if (gone._tag === "None") term.kill("SIGKILL");
        });

      const start = Effect.fn("Terminals.start")(function* (
        sessionId: string,
        root: string,
        size: TerminalSize,
      ) {
        const own = yield* Scope.fork(scope);
        const exited = yield* Deferred.make<number>();
        const started = yield* Effect.acquireRelease(
          Effect.try({
            try: () => {
              if (!statSync(root).isDirectory())
                throw new Error(`${root} isn't a folder`);
              const term = pty.spawn(shell.file, [...shell.args], {
                name: "xterm-256color",
                cols: size.cols,
                rows: size.rows,
                cwd: root,
                // PWD as given, so the shell shows the folder by the path Fern knows it by.
                env: { ...process.env, TERM: "xterm-256color", PWD: root },
              });
              const entry: SessionShell = {
                root,
                term,
                viewers: new Set(),
                printed: scrollback(limit),
                exited,
                scope: own,
                code: undefined,
              };
              const printing = term.onData((data) => {
                entry.printed.append(data);
                for (const viewer of entry.viewers)
                  Queue.offerUnsafe(viewer, { _tag: "TerminalOutput", data });
              });
              const exiting = term.onExit(({ exitCode }) => {
                entry.code = exitCode;
                for (const viewer of entry.viewers) {
                  Queue.offerUnsafe(viewer, exitEvent(exitCode));
                  Queue.endUnsafe(viewer);
                }
                entry.viewers.clear();
                // All that's left to show is how it ended.
                printing.dispose();
                exiting.dispose();
                entry.term = undefined;
                entry.printed.shrink(exitLimit);
                Deferred.doneUnsafe(exited, Exit.succeed(exitCode));
              });
              return entry;
            },
            catch: (error) =>
              new TerminalError({
                message: `Couldn't start ${shell.file} in ${root}: ${error instanceof Error ? error.message : String(error)}`,
              }),
          }),
          stop,
        ).pipe(
          Scope.provide(own),
          Effect.onError(() => Scope.close(own, Exit.void)),
        );
        shells.set(sessionId, started);
        // Once the shell exits by itself, its finalizer has nothing left to do.
        yield* Deferred.await(exited).pipe(
          Effect.andThen(Scope.close(own, Exit.void)),
          Effect.forkIn(scope),
        );
        return started;
      });

      // Ends the Session's shell and forgets it.
      const end = (sessionId: string) =>
        Effect.gen(function* () {
          const entry = shells.get(sessionId);
          if (entry === undefined) return;
          shells.delete(sessionId);
          yield* Scope.close(entry.scope, Exit.void);
        });

      const attach = (sessionId: string, root: string, size: TerminalSize) =>
        Effect.gen(function* () {
          const current = shells.get(sessionId);
          if (current?.root === root) {
            current.term?.resize(size.cols, size.rows);
            return current;
          }
          yield* end(sessionId);
          return yield* start(sessionId, root, size);
        }).pipe(lock.withPermits(1));

      const open = (sessionId: string, root: string, size: TerminalSize) =>
        Stream.callback<TerminalEvent, TerminalError>((viewer) =>
          Effect.gen(function* () {
            const entry = yield* attach(sessionId, root, size);
            yield* Effect.acquireRelease(
              Effect.sync(() => {
                Queue.offerUnsafe(viewer, {
                  _tag: "TerminalReplay",
                  data: entry.printed.text(),
                });
                if (entry.code === undefined) entry.viewers.add(viewer);
                else {
                  Queue.offerUnsafe(viewer, exitEvent(entry.code));
                  Queue.endUnsafe(viewer);
                }
              }),
              () => Effect.sync(() => entry.viewers.delete(viewer)),
            );
          }),
        );

      const write = (sessionId: string, data: string) =>
        Effect.sync(() => shells.get(sessionId)?.term?.write(data));

      const resize = (sessionId: string, size: TerminalSize) =>
        Effect.sync(() =>
          shells.get(sessionId)?.term?.resize(size.cols, size.rows),
        );

      const kill = Effect.fn("Terminals.kill")(function* (sessionId: string) {
        yield* end(sessionId);
      }, lock.withPermits(1));

      return Terminals.of({ open, write, resize, kill });
    }),
  );
}
