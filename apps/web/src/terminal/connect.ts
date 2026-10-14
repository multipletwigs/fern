import type { TerminalTarget } from "@repo/api";
import type { Terminal } from "@xterm/xterm";
import { Effect, Predicate, Queue, Schedule, Stream } from "effect";
import { LiveClient } from "../LiveClient";
import { type Outgoing, outgoing } from "./outgoing";

// A terminal's width or height as the server takes it.
const cells = (n: number) => Math.min(Math.max(Math.round(n), 1), 1000);

// Attach again after a dropped connection, but not when the shell couldn't be started.
const reattach = Schedule.spaced("1 second").pipe(
  Schedule.while(({ input }) => !Predicate.isTagged(input, "TerminalError")),
);

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// Connects an xterm to its target's shell, a Session's or a Foreign PR's: what the shell has
// printed, and goes on to print, is written to it, and what's typed or pasted into it, and its
// size, go to the shell. Runs until interrupted, which detaches from the shell without ending it,
// or until the shell exits, which it tells `onExit`.
export const runTerminal = (
  term: Terminal,
  target: TerminalTarget,
  onExit: (code: number) => void,
) =>
  Effect.gen(function* () {
    const client = yield* LiveClient;
    const outbox = yield* Queue.unbounded<Outgoing>();
    yield* Effect.acquireRelease(
      Effect.sync(() => [
        term.onData((data) =>
          Queue.offerUnsafe(outbox, { _tag: "Input", data }),
        ),
        term.onResize(({ cols, rows }) =>
          Queue.offerUnsafe(outbox, { _tag: "Resize", cols, rows }),
        ),
      ]),
      (listeners) =>
        Effect.sync(() => listeners.forEach((listener) => listener.dispose())),
    );
    const send = (message: Outgoing) =>
      (message._tag === "Input"
        ? client("TerminalInput", { target, data: message.data })
        : client("TerminalResize", {
            target,
            cols: cells(message.cols),
            rows: cells(message.rows),
          })
      ).pipe(Effect.ignore);
    yield* Queue.takeAll(outbox).pipe(
      Effect.flatMap((messages) => Effect.forEach(outgoing(messages), send)),
      Effect.forever,
      Effect.forkScoped,
    );
    // The connection drops now and then, as when the page sits in the background; the shell
    // runs on regardless, so attach to it again, at the size the terminal is by then. Each
    // attachment starts with everything the shell printed so far, which takes the place of what
    // the terminal shows, so nothing shows twice.
    yield* Stream.suspend(() =>
      client("Terminal", {
        target,
        cols: cells(term.cols),
        rows: cells(term.rows),
      }),
    ).pipe(
      Stream.retry(reattach),
      Stream.runForEach((event) =>
        Effect.sync(() => {
          if (event._tag === "TerminalExit") return onExit(event.code);
          if (event._tag === "TerminalReplay") term.reset();
          term.write(event.data);
        }),
      ),
      Effect.catch((error) =>
        Effect.sync(() =>
          term.write(
            `\r\n${DIM}[${"message" in error ? error.message : String(error)}]${RESET}\r\n`,
          ),
        ),
      ),
    );
  }).pipe(Effect.scoped);

// Ends a terminal's shell, if it's still running, so the next `runTerminal` starts a fresh one.
export const restartTerminal = (target: TerminalTarget) =>
  Effect.gen(function* () {
    const client = yield* LiveClient;
    yield* client("TerminalRestart", { target });
  });
