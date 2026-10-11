import type {
  SessionHeader,
  TranscriptItem,
  TranscriptUpdate,
} from "@repo/api";
import { Effect, Schedule, Stream } from "effect";
import { Atom } from "effect/reactivity";
import { ApiClient } from "../ApiClient";

export const currentSessionAtom = ApiClient.query("sessions", "current", {});

export interface Transcript {
  readonly header: SessionHeader | undefined;
  readonly items: ReadonlyArray<TranscriptItem>;
}

const apply = (
  state: Transcript,
  { header, order, upserts }: TranscriptUpdate,
): Transcript => {
  const byId = new Map(state.items.map((item) => [item.id, item]));
  for (const item of upserts) byId.set(item.id, item);
  return {
    header,
    items: order.flatMap((id) => byId.get(id) ?? []),
  };
};

// A Session's transcript, kept current by the server's live stream. Reconnects after a dropped
// connection; the server then resends every item.
export const transcriptAtom = Atom.family((id: string) =>
  ApiClient.runtime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* ApiClient;
        return yield* client.sessions.live({ params: { id } });
      }),
    ).pipe(
      Stream.retry(Schedule.spaced("1 second")),
      Stream.scan<Transcript, TranscriptUpdate>(
        () => ({ header: undefined, items: [] }),
        apply,
      ),
    ),
  ),
);
