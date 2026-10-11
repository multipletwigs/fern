import { TranscriptError } from "@repo/api";
import { Effect } from "effect";

// Runs an Agent SDK call, turning a rejection into a TranscriptError named after the call.
export const sdk = <A>(name: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new TranscriptError({ message: `${name}: ${String(cause)}` }),
  });
