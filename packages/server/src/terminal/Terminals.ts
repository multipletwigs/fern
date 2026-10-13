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

// How long a shell gets to exit on its hangup before it's killed outright.
const HANGUP_GRACE = "1 second";

type Viewer = Queue.Queue<TerminalEvent, TerminalError | Cause.Done>;

// A Session's shell on its PTY, and whoever is watching it.
interface Running {
  readonly term: pty.IPty;
  readonly viewers: Set<Viewer>;
  readonly exited: Deferred.Deferred<number>;
}

const exitEvent = (code: number): TerminalEvent => ({
  _tag: "TerminalExit",
  code,
});

// One shell per Session, on a PTY, in the Session's folder. A shell starts the first time its
// Session's terminal is opened and runs until it exits or the service's scope closes, which kills
// every shell still running. Viewers come and go without touching the shell.
export class Terminals extends Context.Service<
  Terminals,
  {
    // Streams what the Session's shell prints, then its exit. Starts the shell in `root` at `size`
    // when none is running, else attaches to the one that is, at `size`.
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
  }
>()("@repo/server/terminal/Terminals") {
  static readonly layer = Layer.effect(
    Terminals,
    Effect.gen(function* () {
      const shell = yield* TerminalShell;
      const scope = yield* Effect.scope;
      const running = new Map<string, Running>();
      // Two viewers opening the same Session at once start one shell.
      const starting = yield* Semaphore.make(1);

      // Hangs up on the shell, and kills it if it doesn't go.
      const stop = ({ term, exited }: Running) =>
        Effect.gen(function* () {
          if (Deferred.isDoneUnsafe(exited)) return;
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
        const shellRunning = yield* Effect.acquireRelease(
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
              const entry: Running = { term, viewers: new Set(), exited };
              term.onData((data) => {
                for (const viewer of entry.viewers)
                  Queue.offerUnsafe(viewer, { _tag: "TerminalOutput", data });
              });
              term.onExit(({ exitCode }) => {
                if (running.get(sessionId) === entry) running.delete(sessionId);
                for (const viewer of entry.viewers) {
                  Queue.offerUnsafe(viewer, exitEvent(exitCode));
                  Queue.endUnsafe(viewer);
                }
                entry.viewers.clear();
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
        ).pipe(Scope.provide(own));
        running.set(sessionId, shellRunning);
        // Once the shell exits by itself, its finalizer has nothing left to do.
        yield* Deferred.await(exited).pipe(
          Effect.andThen(Scope.close(own, Exit.void)),
          Effect.forkIn(scope),
        );
        return shellRunning;
      });

      const attach = (sessionId: string, root: string, size: TerminalSize) =>
        Effect.gen(function* () {
          const current = running.get(sessionId);
          if (current === undefined) return yield* start(sessionId, root, size);
          current.term.resize(size.cols, size.rows);
          return current;
        }).pipe(starting.withPermits(1));

      const open = (sessionId: string, root: string, size: TerminalSize) =>
        Stream.callback<TerminalEvent, TerminalError>((viewer) =>
          Effect.gen(function* () {
            const entry = yield* attach(sessionId, root, size);
            yield* Effect.acquireRelease(
              Effect.sync(() => {
                // It exited while this viewer was attaching.
                if (Deferred.isDoneUnsafe(entry.exited))
                  Queue.endUnsafe(viewer);
                else entry.viewers.add(viewer);
              }),
              () => Effect.sync(() => entry.viewers.delete(viewer)),
            );
          }),
        );

      const write = (sessionId: string, data: string) =>
        Effect.sync(() => running.get(sessionId)?.term.write(data));

      const resize = (sessionId: string, size: TerminalSize) =>
        Effect.sync(() =>
          running.get(sessionId)?.term.resize(size.cols, size.rows),
        );

      return Terminals.of({ open, write, resize });
    }),
  );
}
