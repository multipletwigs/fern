import { Context, Effect, FileSystem, Layer, Option, Path } from "effect";
import { Git, GitError } from "../git/Git";
import {
  type NumstatEntry,
  parseNumstat,
  parsePatch,
  type PatchHunk,
} from "./patch";

// The working tree, untracked files included, as git stores it.
export interface Snapshot {
  readonly commit: string;
  readonly tree: string;
}

// Snapshots are commits that no branch points at, so they never show in history. Hidden refs keep
// them from being garbage-collected, and nothing pushes refs/fern/.
const IDENTITY = {
  GIT_AUTHOR_NAME: "Fern",
  GIT_AUTHOR_EMAIL: "fern@localhost",
  GIT_COMMITTER_NAME: "Fern",
  GIT_COMMITTER_EMAIL: "fern@localhost",
};

const trim = (out: string) => out.trim();

const startRef = (sessionId: string) => `refs/fern/sessions/${sessionId}/start`;
export const walkthroughRef = (id: string) => `refs/fern/walkthroughs/${id}`;

// Takes snapshots of a repository's working tree without touching its index, working tree, or
// history, and compares them.
export class Snapshots extends Context.Service<
  Snapshots,
  {
    // The repository a folder belongs to, as its root.
    repo(cwd: string): Effect.Effect<string, GitError>;
    // The working tree as a tree object, for comparing against a snapshot.
    tree(repo: string): Effect.Effect<string, GitError>;
    take(repo: string, message: string): Effect.Effect<Snapshot, GitError>;
    // Keeps a snapshot under a hidden ref.
    pin(
      repo: string,
      ref: string,
      commit: string,
    ): Effect.Effect<void, GitError>;
    // The snapshot Fern took when a Session started, if it took one.
    start(
      repo: string,
      sessionId: string,
    ): Effect.Effect<
      Option.Option<Snapshot & { readonly takenAt: number }>,
      GitError
    >;
    // Takes the Session's start snapshot, unless there already is one.
    markStart(repo: string, sessionId: string): Effect.Effect<void, GitError>;
    // The last commit's tree, or the empty tree in a repository without commits.
    head(repo: string): Effect.Effect<string, GitError>;
    diff(
      repo: string,
      from: string,
      to: string,
    ): Effect.Effect<ReadonlyArray<PatchHunk>, GitError>;
    numstat(
      repo: string,
      from: string,
      to: string,
    ): Effect.Effect<ReadonlyArray<NumstatEntry>, GitError>;
  }
>()("@repo/server/snapshot/Snapshots") {
  static readonly layer = Layer.effect(
    Snapshots,
    Effect.gen(function* () {
      const git = yield* Git;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const findRepo = Effect.fn("Snapshots.repo")((cwd: string) =>
        git.run(cwd, ["rev-parse", "--show-toplevel"]).pipe(Effect.map(trim)),
      );

      // `git add -A` into a copy of the real index: the copy's stat cache keeps unchanged files from
      // being hashed again, and the real index is never written.
      const workingTree = Effect.fn("Snapshots.tree")(
        function* (repo: string) {
          const dir = yield* fs.makeTempDirectoryScoped({
            prefix: "fern-index-",
          });
          const index = path.join(dir, "index");
          const real = path.resolve(
            repo,
            trim(yield* git.run(repo, ["rev-parse", "--git-path", "index"])),
          );
          if (yield* fs.exists(real)) yield* fs.copyFile(real, index);
          const env = { GIT_INDEX_FILE: index };
          yield* git.run(repo, ["add", "-A", "--", "."], env);
          return trim(yield* git.run(repo, ["write-tree"], env));
        },
        Effect.scoped,
        Effect.catchTag("PlatformError", (cause) =>
          Effect.fail(new GitError({ message: `snapshot: ${cause.message}` })),
        ),
      );

      const take = Effect.fn("Snapshots.take")(function* (
        repo: string,
        message: string,
      ) {
        const snapshot = yield* workingTree(repo);
        const commit = trim(
          yield* git.run(
            repo,
            [
              "-c",
              "commit.gpgsign=false",
              "commit-tree",
              snapshot,
              "-m",
              message,
            ],
            IDENTITY,
          ),
        );
        return { commit, tree: snapshot };
      });

      const pin = Effect.fn("Snapshots.pin")(
        (repo: string, ref: string, commit: string) =>
          git.run(repo, ["update-ref", ref, commit]).pipe(Effect.asVoid),
      );

      const start = Effect.fn("Snapshots.start")(function* (
        repo: string,
        sessionId: string,
      ) {
        const found = yield* git
          .run(repo, [
            "log",
            "-1",
            "--format=%H %T %ct",
            startRef(sessionId),
            "--",
          ])
          .pipe(Effect.option);
        const [commit, snapshot, seconds] = Option.getOrElse(found, () => "")
          .trim()
          .split(" ");
        return commit && snapshot && seconds
          ? Option.some({
              commit,
              tree: snapshot,
              takenAt: Number(seconds) * 1000,
            })
          : Option.none();
      });

      const markStart = Effect.fn("Snapshots.markStart")(function* (
        repo: string,
        sessionId: string,
      ) {
        if (Option.isSome(yield* start(repo, sessionId))) return;
        const snapshot = yield* take(
          repo,
          `Fern: Session ${sessionId} started`,
        );
        yield* pin(repo, startRef(sessionId), snapshot.commit);
      });

      const headTree = Effect.fn("Snapshots.head")((repo: string) =>
        git.run(repo, ["rev-parse", "--verify", "-q", "HEAD^{tree}"]).pipe(
          Effect.catch(() =>
            git.run(repo, ["hash-object", "-t", "tree", "/dev/null"]),
          ),
          Effect.map(trim),
        ),
      );

      const diff = Effect.fn("Snapshots.diff")(
        (repo: string, from: string, to: string) =>
          git
            .run(repo, [
              "diff-tree",
              "-r",
              "-p",
              "--no-renames",
              "--no-color",
              "--no-ext-diff",
              from,
              to,
            ])
            .pipe(Effect.map(parsePatch)),
      );

      const numstat = Effect.fn("Snapshots.numstat")(
        (repo: string, from: string, to: string) =>
          git
            .run(repo, [
              "diff-tree",
              "-r",
              "--numstat",
              "-z",
              "--no-renames",
              from,
              to,
            ])
            .pipe(Effect.map(parseNumstat)),
      );

      return Snapshots.of({
        repo: findRepo,
        tree: workingTree,
        take,
        pin,
        start,
        markStart,
        head: headTree,
        diff,
        numstat,
      });
    }),
  ).pipe(Layer.provide(Git.layer));
}
