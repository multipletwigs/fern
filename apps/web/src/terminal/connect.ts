import type { Terminal } from "@xterm/xterm";
import { Effect, Predicate, Queue, Schedule, Stream } from "effect";
import { LiveClient } from "../LiveClient";

// What the page tells a Session's shell, in the order it happened.
type Outgoing =
  | { readonly _tag: "Input"; readonly data: string }
  | { readonly _tag: "Resize"; readonly cols: number; readonly rows: number };

// Keystrokes typed back to back go as one write; the order of everything else stays.
const coalesce = (messages: ReadonlyArray<Outgoing>) =>
  messages.reduce<Array<Outgoing>>((sent, message) => {
    const last = sent.at(-1);
    if (last?._tag === "Input" && message._tag === "Input")
      sent[sent.length - 1] = { _tag: "Input", data: last.data + message.data };
    else sent.push(message);
    return sent;
  }, []);

// Attach again after a dropped connection, but not when the shell couldn't be started.
const reattach = Schedule.spaced("1 second").pipe(
  Schedule.while(({ input }) => !Predicate.isTagged(input, "TerminalError")),
);

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// Connects an xterm to its Session's shell: what the shell prints is written to it, and what's
// typed or pasted into it, and its size, go to the shell. Runs until interrupted, which detaches
// from the shell without ending it, or until the shell exits.
export const runTerminal = (term: Terminal, sessionId: string, root: string) =>
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
        ? client("TerminalInput", { sessionId, data: message.data })
        : client("TerminalResize", {
            sessionId,
            cols: message.cols,
            rows: message.rows,
          })
      ).pipe(Effect.ignore);
    yield* Queue.takeAll(outbox).pipe(
      Effect.flatMap((messages) => Effect.forEach(coalesce(messages), send)),
      Effect.forever,
      Effect.forkScoped,
    );
    // The connection drops now and then, as when the page sits in the background; the shell
    // runs on regardless, so attach to it again, at the size the terminal is by then.
    yield* Stream.suspend(() =>
      client("Terminal", { sessionId, root, cols: term.cols, rows: term.rows }),
    ).pipe(
      Stream.retry(reattach),
      Stream.runForEach((event) =>
        Effect.sync(() =>
          event._tag === "TerminalOutput"
            ? term.write(event.data)
            : term.write(
                `\r\n${DIM}[The shell exited with code ${event.code}.]${RESET}\r\n`,
              ),
        ),
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
