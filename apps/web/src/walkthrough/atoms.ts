import { Effect, Schedule, Stream } from "effect";
import { Atom } from "effect/reactivity";
import { ApiClient } from "../ApiClient";

// A Session's Walkthroughs, oldest first, kept current by the server.
export const walkthroughsAtom = Atom.family((sessionId: string) =>
  ApiClient.runtime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* ApiClient;
        return yield* client.walkthroughs.list({
          query: { session: sessionId },
        });
      }),
    ).pipe(Stream.retry(Schedule.spaced("2 seconds"))),
  ),
);

export const writeWalkthroughAtom = ApiClient.mutation("walkthroughs", "write");
export const verdictAtom = ApiClient.mutation("walkthroughs", "verdict");
export const redirectAtom = ApiClient.mutation("walkthroughs", "redirect");
