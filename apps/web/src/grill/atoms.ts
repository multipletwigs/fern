import { Effect, Schedule, Stream } from "effect";
import { Atom } from "effect/reactivity";
import { ApiClient } from "../ApiClient";
import { LiveClient } from "../LiveClient";
import { resubscribe } from "../resubscribe";
import { type Draft, emptyDraft } from "./draft";

// A Session's open Round and its Decisions, kept current by the server. Stays loaded a while after
// it leaves the screen, like the Session's transcript.
export const roundsAtom = Atom.family((sessionId: string) =>
  LiveClient.runtime
    .atom(
      Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* LiveClient;
          return client("Rounds", { session: sessionId });
        }),
      ).pipe(resubscribe(Schedule.spaced("2 seconds"))),
    )
    .pipe(Atom.setIdleTTL("1 minute")),
);

export const answerRoundAtom = ApiClient.mutation("rounds", "answer");

// The developer's answers to a Round so far, kept while they switch to the transcript and back.
export const draftAtom = Atom.family((_roundId: string) =>
  Atom.make<Draft>(emptyDraft).pipe(Atom.keepAlive),
);
