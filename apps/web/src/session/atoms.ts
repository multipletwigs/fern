import type {
  SessionHeader,
  TranscriptItem,
  TranscriptUpdate,
} from "@repo/api";
import { Effect, Schedule, Stream } from "effect";
import { Atom, AsyncResult } from "effect/reactivity";
import { ApiClient } from "../ApiClient";

export const currentSessionAtom = ApiClient.query("sessions", "current", {});

export const sendMessageAtom = ApiClient.mutation("sessions", "send");
export const interruptAtom = ApiClient.mutation("sessions", "interrupt");

// The Session picked in the sidebar; until one is picked, the screen follows the current Session.
export const selectedSessionAtom = Atom.make<string | undefined>(
  undefined,
).pipe(Atom.keepAlive);

// Every Project and its Sessions, kept current by the server's live stream.
export const projectsAtom = ApiClient.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* ApiClient;
      return yield* client.sessions.projects();
    }),
  ).pipe(Stream.retry(Schedule.spaced("1 second"))),
);

// The Session on screen: the one picked in the sidebar, else the current one.
export const activeSessionIdAtom = Atom.make((get) => {
  const selected = get(selectedSessionAtom);
  if (selected) return selected;
  const current = get(currentSessionAtom);
  return AsyncResult.isSuccess(current) ? current.value.id : undefined;
});

// The Project the Session on screen ran in.
export const activeProjectAtom = Atom.make((get) => {
  const id = get(activeSessionIdAtom);
  const projects = get(projectsAtom);
  if (id === undefined || !AsyncResult.isSuccess(projects)) return undefined;
  return projects.value.find((project) =>
    project.sessions.some((session) => session.id === id),
  );
});

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
