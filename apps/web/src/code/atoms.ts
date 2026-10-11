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

// The file the developer opened for a Session, as an absolute path. Until they open one, the code
// panel follows the file Claude last touched.
export const openFileAtom = Atom.family((_sessionId: string) =>
  Atom.make<string | undefined>(undefined).pipe(Atom.keepAlive),
);
