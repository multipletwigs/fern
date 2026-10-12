import { Effect, Schedule, Stream } from "effect";
import { Atom } from "effect/reactivity";
import { ApiClient } from "../ApiClient";
import { LiveClient } from "../LiveClient";
import { resubscribe } from "../resubscribe";

// A Session's Project's streaks, Milestone offers and Autonomy, with what Fern approved in the
// Session; null for a Session outside the Flow.
export const autonomyAtom = Atom.family((sessionId: string) =>
  LiveClient.runtime
    .atom(
      Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* LiveClient;
          return client("Autonomy", { session: sessionId });
        }),
      ).pipe(resubscribe(Schedule.spaced("2 seconds"))),
    )
    .pipe(Atom.setIdleTTL("1 minute")),
);

export const acceptMilestoneAtom = ApiClient.mutation("autonomy", "accept");
export const declineMilestoneAtom = ApiClient.mutation("autonomy", "decline");
