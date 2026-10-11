import { Effect, Predicate, Schedule, Stream } from "effect";
import { Atom } from "effect/reactivity";
import { ApiClient } from "../ApiClient";

// Reconnect after a dropped connection, but not when the server has said why it can't serve this.
const reconnect = Schedule.spaced("2 seconds").pipe(
  Schedule.while(
    ({ input }) =>
      !Predicate.isTagged(input, "ProjectNotFound") &&
      !Predicate.isTagged(input, "FileNotFound") &&
      !Predicate.isTagged(input, "WorkspaceError"),
  ),
);

// A Project's files, kept current by the server.
export const projectFilesAtom = Atom.family((root: string) =>
  ApiClient.runtime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* ApiClient;
        return yield* client.projects.files({ query: { root } });
      }),
    ).pipe(Stream.retry(reconnect)),
  ),
);

// One file's content, re-sent whenever it changes on disk.
export const fileAtom = Atom.family((root: string) =>
  Atom.family((path: string) =>
    ApiClient.runtime.atom(
      Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* ApiClient;
          return yield* client.projects.file({ query: { root, path } });
        }),
      ).pipe(Stream.retry(reconnect)),
    ),
  ),
);

// A Session's net change in the Project, from git, kept current by the server.
export const sessionChangesAtom = Atom.family((root: string) =>
  Atom.family((sessionId: string) =>
    ApiClient.runtime.atom(
      Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* ApiClient;
          return yield* client.projects.changes({
            query: { root, session: sessionId },
          });
        }),
      ).pipe(Stream.retry(reconnect)),
    ),
  ),
);

// What the code panel shows: a file, as an absolute path, or a Walkthrough.
export type OpenItem =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "walkthrough"; readonly id: string };

// What the developer opened in a Session's code panel. Until they open something, the panel
// follows Claude: a Walkthrough waiting on the developer, else the file Claude last changed.
export const openAtom = Atom.family((_sessionId: string) =>
  Atom.make<OpenItem | undefined>(undefined).pipe(Atom.keepAlive),
);
