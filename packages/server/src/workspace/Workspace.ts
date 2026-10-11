import {
  ChangedFile,
  FileContent,
  FileNotFound,
  ProjectNotFound,
  SessionChanges,
  WorkspaceError,
} from "@repo/api";
import {
  Context,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schedule,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type { GitError } from "../git/Git";
import { Snapshots } from "../snapshot/Snapshots";
import { HostedSessions } from "../turn/HostedSessions";

// Files above this size are listed but not sent.
const MAX_FILE_BYTES = 1_000_000;
// A NUL byte this early means the file isn't text.
const BINARY_SNIFF_BYTES = 8_000;

const decoder = new TextDecoder();

const mtimeMs = (info: FileSystem.File.Info) =>
  Option.getOrUndefined(info.mtime)?.getTime();

const gitFailed = (error: GitError) =>
  new WorkspaceError({ message: error.message });

// Reads a Project's code from the folder its Sessions ran in. Only those folders can be read, and
// only paths inside them, symlinks included.
export class Workspace extends Context.Service<
  Workspace,
  {
    // Every file git doesn't ignore, relative to the folder, re-sent when the set changes.
    files(
      root: string,
    ): Effect.Effect<
      Stream.Stream<ReadonlyArray<string>, WorkspaceError>,
      ProjectNotFound | WorkspaceError
    >;
    // What a Session changed in the folder, from git, re-sent when it changes.
    changes(
      root: string,
      sessionId: string,
    ): Effect.Effect<
      Stream.Stream<SessionChanges, WorkspaceError>,
      ProjectNotFound | WorkspaceError
    >;
    // One file, re-sent whenever it changes on disk. Ends if the file is deleted.
    file(
      root: string,
      path: string,
    ): Effect.Effect<
      Stream.Stream<FileContent, WorkspaceError>,
      ProjectNotFound | FileNotFound | WorkspaceError
    >;
  }
>()("@repo/server/workspace/Workspace") {
  static readonly layer = Layer.effect(
    Workspace,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const snapshots = yield* Snapshots;
      const hosted = yield* HostedSessions;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const project = Effect.fn("Workspace.project")(function* (root: string) {
        const known = yield* hosted
          .isProject(root)
          .pipe(
            Effect.mapError((e) => new WorkspaceError({ message: e.message })),
          );
        if (!known) return yield* new ProjectNotFound({ root });
        return yield* fs
          .realPath(root)
          .pipe(Effect.mapError(() => new ProjectNotFound({ root })));
      });

      // NUL-separated output, so paths with spaces or newlines survive.
      const git = (root: string, args: ReadonlyArray<string>) =>
        spawner.string(ChildProcess.make("git", ["-C", root, ...args])).pipe(
          Effect.map((out) => out.split("\0").filter(Boolean)),
          Effect.mapError(
            (cause) =>
              new WorkspaceError({
                message: `git ${args[0]}: ${String(cause)}`,
              }),
          ),
        );

      const files = Effect.fn("Workspace.files")(function* (root: string) {
        const real = yield* project(root);
        const inside = yield* spawner
          .string(
            ChildProcess.make("git", [
              "-C",
              real,
              "rev-parse",
              "--is-inside-work-tree",
            ]),
          )
          .pipe(Effect.orElseSucceed(() => ""));
        if (inside.trim() !== "true")
          return yield* new WorkspaceError({
            message: `${root} isn't a git repository`,
          });

        const list = Effect.all([
          git(real, [
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            "--deduplicate",
          ]),
          // Tracked files deleted from the working tree are still "cached".
          git(real, ["ls-files", "-z", "--deleted"]),
        ]).pipe(
          Effect.map(([all, deleted]) => {
            const gone = new Set(deleted);
            return all.filter((file) => !gone.has(file)).toSorted();
          }),
        );

        return Stream.fromEffectSchedule(
          list,
          Schedule.spaced("2 seconds"),
        ).pipe(Stream.changesWith((a, b) => a.join("\0") === b.join("\0")));
      });

      const file = Effect.fn("Workspace.file")(function* (
        root: string,
        relative: string,
      ) {
        const real = yield* project(root);
        const notFound = () => new FileNotFound({ path: relative });
        const resolved = yield* fs
          .realPath(path.resolve(real, relative))
          .pipe(Effect.mapError(notFound));
        const within = path.relative(real, resolved);
        if (within.startsWith("..") || path.isAbsolute(within))
          return yield* notFound();

        const stat = fs.stat(resolved).pipe(
          Effect.mapError(notFound),
          Effect.filterOrFail((info) => info.type === "File", notFound),
        );
        yield* stat;

        const read = Effect.fn("Workspace.read")(function* (
          info: FileSystem.File.Info,
        ) {
          const modifiedAt = DateTime.makeUnsafe(mtimeMs(info) ?? 0);
          if (Number(info.size) > MAX_FILE_BYTES)
            return FileContent.make({
              path: within,
              content: "",
              skipped: "tooLarge",
              modifiedAt,
            });
          const bytes = yield* fs
            .readFile(resolved)
            .pipe(
              Effect.mapError(
                (e) => new WorkspaceError({ message: e.message }),
              ),
            );
          const binary = bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);
          return FileContent.make({
            path: within,
            content: binary ? "" : decoder.decode(bytes),
            skipped: binary ? "binary" : undefined,
            modifiedAt,
          });
        });

        return Stream.fromEffectSchedule(
          stat,
          Schedule.spaced("500 millis"),
        ).pipe(
          Stream.catchTag("FileNotFound", () => Stream.empty),
          Stream.changesWith(
            (a, b) => mtimeMs(a) === mtimeMs(b) && a.size === b.size,
          ),
          Stream.mapEffect(read),
        );
      });

      // Against the Session's start snapshot, so a commit, a rollback, or a change made through Bash
      // all count as the net change they are. Without one, the uncommitted change stands in.
      const changes = Effect.fn("Workspace.changes")(function* (
        root: string,
        sessionId: string,
      ) {
        const real = yield* project(root);
        const repo = yield* snapshots
          .repo(real)
          .pipe(Effect.mapError(gitFailed));
        // Paths from git are relative to the repository; the panel's are relative to the folder.
        const prefix = path.relative(repo, real);
        const read = Effect.gen(function* () {
          const start = yield* snapshots.start(repo, sessionId);
          const base = Option.isSome(start)
            ? start.value.tree
            : yield* snapshots.head(repo);
          const entries = yield* snapshots.numstat(
            repo,
            base,
            yield* snapshots.tree(repo),
          );
          return SessionChanges.make({
            since: Option.isSome(start) ? "start" : "head",
            files: entries.flatMap((entry) => {
              const within = prefix
                ? path.relative(prefix, entry.path)
                : entry.path;
              return within.startsWith("..")
                ? []
                : [ChangedFile.make({ ...entry, path: within })];
            }),
          });
        }).pipe(Effect.mapError(gitFailed));

        return Stream.fromEffectSchedule(
          read,
          Schedule.spaced("2 seconds"),
        ).pipe(
          Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        );
      });

      return Workspace.of({ files, file, changes });
    }),
  );
}
