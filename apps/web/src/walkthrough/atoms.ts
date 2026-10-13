import { Effect, Schedule, Stream } from "effect";
import { Atom } from "effect/reactivity";
import { ApiClient } from "../ApiClient";
import { LiveClient } from "../LiveClient";
import { resubscribe } from "../resubscribe";

// A Session's Walkthroughs, oldest first, kept current by the server. Stays loaded a while after it
// leaves the screen, like the Session's transcript.
export const walkthroughsAtom = Atom.family((sessionId: string) =>
  LiveClient.runtime
    .atom(
      Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* LiveClient;
          return client("Walkthroughs", { session: sessionId });
        }),
      ).pipe(resubscribe(Schedule.spaced("2 seconds"))),
    )
    .pipe(Atom.setIdleTTL("1 minute")),
);

export const writeWalkthroughAtom = ApiClient.mutation("walkthroughs", "write");
export const verdictAtom = ApiClient.mutation("walkthroughs", "verdict");
export const redirectAtom = ApiClient.mutation("walkthroughs", "redirect");
export const rewriteWalkthroughAtom = ApiClient.mutation(
  "walkthroughs",
  "rewrite",
);
