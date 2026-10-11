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

// A message the developer just sent, shown in the transcript before Claude Code records it. It
// stands in until a developer turn newer than `after` (the latest one when it was sent) arrives.
export interface PendingPrompt {
  readonly id: string;
  // The slash command, without its slash, when the message is one; `text` is then its arguments.
  readonly command: string | undefined;
  readonly text: string;
  readonly images: ReadonlyArray<string>;
  readonly after: string | undefined;
}
export const pendingPromptAtom = Atom.family((_sessionId: string) =>
  Atom.make<PendingPrompt | undefined>(undefined),
);
export const startSessionAtom = ApiClient.mutation("sessions", "start");
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

// The folder of a blank Session on screen, opened by /clear, until its first message starts it.
export const newSessionAtom = Atom.make<string | undefined>(undefined).pipe(
  Atom.keepAlive,
);

// The slash commands Claude Code offers in a Project's folder.
export const commandsAtom = Atom.family((root: string) =>
  ApiClient.query("projects", "commands", { query: { root } }),
);

// The Session on screen: none while a new one is open, else the one picked in the sidebar, else
// the current one.
export const activeSessionIdAtom = Atom.make((get) => {
  if (get(newSessionAtom) !== undefined) return undefined;
  const selected = get(selectedSessionAtom);
  if (selected) return selected;
  const current = get(currentSessionAtom);
  return AsyncResult.isSuccess(current) ? current.value.id : undefined;
});

// The Project the Session on screen ran in.
export const activeProjectAtom = Atom.make((get) => {
  const id = get(activeSessionIdAtom);
  const root = get(newSessionAtom);
  const projects = get(projectsAtom);
  if (!AsyncResult.isSuccess(projects)) return undefined;
  return projects.value.find((project) =>
    root !== undefined
      ? project.path === root
      : project.sessions.some((session) => session.id === id),
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
