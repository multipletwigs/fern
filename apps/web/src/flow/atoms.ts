import { Effect, Schedule, Stream } from "effect";
import { Atom } from "effect/reactivity";
import { ApiClient } from "../ApiClient";
import { LiveClient } from "../LiveClient";

// A Session's Flow, kept current by the server; null for a Session outside the Flow.
export const flowAtom = Atom.family((sessionId: string) =>
  LiveClient.runtime
    .atom(
      Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* LiveClient;
          return client("Flow", { session: sessionId });
        }),
      ).pipe(Stream.retry(Schedule.spaced("2 seconds"))),
    )
    .pipe(Atom.setIdleTTL("1 minute")),
);

// Every Session's pending Checkpoint, oldest first.
export const checkpointsAtom = LiveClient.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* LiveClient;
      return client("Checkpoints", undefined);
    }),
  ).pipe(Stream.retry(Schedule.spaced("2 seconds"))),
);

// Every Hosted Session's current Phase.
export const sessionPhasesAtom = LiveClient.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* LiveClient;
      return client("SessionPhases", undefined);
    }),
  ).pipe(Stream.retry(Schedule.spaced("2 seconds"))),
);

export const approveCheckpointAtom = ApiClient.mutation("flows", "approve");
export const declineCheckpointAtom = ApiClient.mutation("flows", "decline");
