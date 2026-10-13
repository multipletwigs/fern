import { Effect, Predicate, Schedule, Stream } from "effect";
import { Atom } from "effect/reactivity";
import { LiveClient } from "../LiveClient";
import { resubscribe } from "../resubscribe";

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
  LiveClient.runtime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* LiveClient;
        return client("ProjectFiles", { root });
      }),
    ).pipe(resubscribe(reconnect)),
  ),
);

// One file's content, re-sent whenever it changes on disk.
export const fileAtom = Atom.family((root: string) =>
  Atom.family((path: string) =>
    LiveClient.runtime.atom(
      Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* LiveClient;
          return client("File", { root, path });
        }),
      ).pipe(resubscribe(reconnect)),
    ),
  ),
);

// A Session's net change in the Project, from git, kept current by the server. Stays loaded a
// while after it leaves the screen, like the Session's transcript. One family keyed by both, as a
// family of families can drop the inner one, and with it the loaded atoms.
const changesFamily = Atom.family((key: string) => {
  const [root = "", session = ""] = key.split("\0");
  return LiveClient.runtime
    .atom(
      Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* LiveClient;
          return client("Changes", { root, session });
        }),
      ).pipe(resubscribe(reconnect)),
    )
    .pipe(Atom.setIdleTTL("1 minute"));
});
export const sessionChangesAtom = (root: string, sessionId: string) =>
  changesFamily(`${root}\0${sessionId}`);
