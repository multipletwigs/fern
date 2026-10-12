import type {
  SessionHeader,
  SubagentHeader,
  SubagentUpdate,
  TranscriptItem,
  TranscriptUpdate,
} from "@repo/api";
import { Effect, Predicate, Schedule, Stream } from "effect";
import { Atom, AsyncResult } from "effect/reactivity";
import { ApiClient } from "../ApiClient";
import { LiveClient } from "../LiveClient";
import { resubscribe } from "../resubscribe";

// The latest Session. The page can load before the main process serves the API, so a dropped
// request is retried; only the server saying there's no Session ends it.
export const currentSessionAtom = ApiClient.runtime.atom(
  Effect.gen(function* () {
    const client = yield* ApiClient;
    return yield* client.sessions.current();
  }).pipe(
    Effect.retry(
      Schedule.spaced("1 second").pipe(
        Schedule.while(
          ({ input }) =>
            !Predicate.isTagged(input, "SessionNotFound") &&
            !Predicate.isTagged(input, "TranscriptError"),
        ),
      ),
    ),
  ),
);

export const sendMessageAtom = ApiClient.mutation("sessions", "send");

// A message the developer just sent, shown in the transcript before Claude Code records it. It
// stands in until a developer turn newer than `after` (the latest one when it was sent) arrives,
// or the turn ends without recording it, as when stopped at once.
export interface PendingPrompt {
  readonly id: string;
  readonly sentAt: number;
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
export const unqueueAtom = ApiClient.mutation("sessions", "unqueue");
export const archiveSessionAtom = ApiClient.mutation("sessions", "archive");
export const closeSubagentAtom = ApiClient.mutation("subagents", "close");
export const reopenSubagentAtom = ApiClient.mutation("subagents", "reopen");

// The Session picked in the sidebar; until one is picked, the screen follows the current Session.
export const selectedSessionAtom = Atom.make<string | undefined>(
  undefined,
).pipe(Atom.keepAlive);

// Every Project and its Sessions, kept current by the server's live stream.
export const projectsAtom = LiveClient.runtime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* LiveClient;
      return client("Projects", undefined);
    }),
  ).pipe(resubscribe(Schedule.spaced("1 second"))),
);

// The Session the pointer last rested on in the sidebar, drawn out of sight so picking it shows it
// at once.
export const preloadedSessionAtom = Atom.make<string | undefined>(
  undefined,
).pipe(Atom.keepAlive);

// The folder of a blank Session on screen, opened by /clear, until its first message starts it.
export const newSessionAtom = Atom.make<string | undefined>(undefined).pipe(
  Atom.keepAlive,
);

// The slash commands Claude Code offers in a Project's folder.
export const commandsAtom = Atom.family((root: string) =>
  ApiClient.query("projects", "commands", { query: { root } }),
);

// The model picked for a Session in its composer. Every message sent from Fern then runs on it;
// until one is picked, Claude Code runs the Session on its default.
export const modelChoiceAtom = Atom.family((_sessionId: string) =>
  Atom.make<string | undefined>(undefined).pipe(Atom.keepAlive),
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

// The folder the code on screen is read from: the worktree Fern made for the Session, else its
// Project's folder.
export const activeCodeRootAtom = Atom.make((get) => {
  const id = get(activeSessionIdAtom);
  const project = get(activeProjectAtom);
  const session = project?.sessions.find((s) => s.id === id);
  return session?.worktree ?? project?.path;
});

export interface Transcript {
  readonly header: SessionHeader | undefined;
  readonly items: ReadonlyArray<TranscriptItem>;
}

// The items after a live update: in its order, each the latest version sent.
const applyItems = (
  items: ReadonlyArray<TranscriptItem>,
  {
    order,
    upserts,
  }: {
    readonly order: ReadonlyArray<string>;
    readonly upserts: ReadonlyArray<TranscriptItem>;
  },
) => {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of upserts) byId.set(item.id, item);
  return order.flatMap((id) => byId.get(id) ?? []);
};

const apply = (state: Transcript, update: TranscriptUpdate): Transcript => ({
  header: update.header,
  items: applyItems(state.items, update),
});

// A Session's transcript, kept current by the server's live stream. Resubscribes after a dropped
// connection or an ended stream; the server then resends every item. Stays loaded a while after it
// leaves the screen, so switching back to it is instant.
export const transcriptAtom = Atom.family((id: string) =>
  LiveClient.runtime
    .atom(
      Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* LiveClient;
          return client("Transcript", { id });
        }),
      ).pipe(
        resubscribe(Schedule.spaced("1 second")),
        Stream.scan<Transcript, TranscriptUpdate>(
          () => ({ header: undefined, items: [] }),
          apply,
        ),
      ),
    )
    .pipe(Atom.setIdleTTL("1 minute")),
);

// A Session's Subagents in the order they started, kept current by the server's live stream.
export const subagentsAtom = Atom.family((sessionId: string) =>
  LiveClient.runtime
    .atom(
      Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* LiveClient;
          return client("Subagents", { sessionId });
        }),
      ).pipe(resubscribe(Schedule.spaced("1 second"))),
    )
    .pipe(Atom.setIdleTTL("1 minute")),
);

export interface SubagentView {
  readonly header: SubagentHeader | undefined;
  readonly assignment: string;
  readonly items: ReadonlyArray<TranscriptItem>;
  readonly handBack: string | undefined;
}

// The key of one Subagent's view: its Session and its agent id.
export const subagentKey = (sessionId: string, agentId: string) =>
  `${sessionId} ${agentId}`;

// One Subagent's Assignment and work, kept current by the server's live stream, keyed by
// `subagentKey`. Stays loaded a while after it leaves the screen, so switching back is instant.
export const subagentAtom = Atom.family((key: string) => {
  const [sessionId = "", agentId = ""] = key.split(" ");
  return LiveClient.runtime
    .atom(
      Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* LiveClient;
          return client("Subagent", { sessionId, agentId });
        }),
      ).pipe(
        resubscribe(Schedule.spaced("1 second")),
        Stream.scan<SubagentView, SubagentUpdate>(
          () => ({
            header: undefined,
            assignment: "",
            items: [],
            handBack: undefined,
          }),
          (state, update) => ({
            header: update.header,
            assignment: update.assignment,
            items: applyItems(state.items, update),
            handBack: update.handBack,
          }),
        ),
      ),
    )
    .pipe(Atom.setIdleTTL("1 minute"));
});
