import { WorktreeError } from "@repo/api";
import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { Git } from "../git/Git";

// Where Fern keeps its Sessions' worktrees: a folder of its own app data, never inside a repo.
export class WorktreesDir extends Context.Service<
  WorktreesDir,
  { readonly dir: string }
>()("@repo/server/worktree/WorktreesDir") {}

// A branch and worktree made for one Hosted Session (ADR 0005).
export interface Worktree {
  // The Project's folder the Session was started from, which it is listed under.
  readonly projectRoot: string;
  readonly branch: string;
  // The commit the branch started from. Until the branch moves past it, it only looks merged.
  readonly base: string;
  // The worktree's root.
  readonly path: string;
  // Where the Session runs: the Project's folder within the worktree.
  readonly cwd: string;
}

const MAX_SLUG = 40;

// A branch name from the opening prompt: its words, lowercased and joined by dashes.
const slug = (prompt: string) =>
  prompt
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_SLUG)
    .replace(/^-+|-+$/g, "") || "session";

const trim = (out: string) => out.trim();

const failed = (message: string) => new WorktreeError({ message });

// Branches and worktrees for Hosted Sessions, outside the developer's checkout.
export class Worktrees extends Context.Service<
  Worktrees,
  {
    // Whether the folder is in a git repository with a commit to start a branch from.
    branchable(root: string): Effect.Effect<boolean>;
    // A new branch from the tip of `main`, named after the opening prompt plus a short id, checked
    // out in a new worktree under Fern's app data.
    create(
      root: string,
      openingPrompt: string,
    ): Effect.Effect<Worktree, WorktreeError>;
    // Whether the branch, made from `base` in the repo at `root`, has merged into `main`: it moved
    // past `base`, and either its tip is in `main`'s history, or merging it would change nothing
    // in `main`, as after a squash merge. A branch still at `base` hasn't merged, it's only new.
    isMerged(
      root: string,
      branch: string,
      base: string,
    ): Effect.Effect<boolean>;
    // Whether the worktree at `path` has changes not yet committed, untracked files included. One
    // that's gone has none.
    isDirty(path: string): Effect.Effect<boolean, WorktreeError>;
    // Whether the branch, made from `base` in the repo at `root`, has moved past it: one deleted, or
    // that Fern can't read, counts as moved, so nothing is taken for unused that might not be.
    hasCommits(
      root: string,
      branch: string,
      base: string,
    ): Effect.Effect<boolean>;
    // Renames the branch the worktree at `path` has checked out after `topic`, keeping the short id
    // that makes it unique, and returns the new name.
    rename(
      path: string,
      branch: string,
      topic: string,
    ): Effect.Effect<string, WorktreeError>;
    // Deletes the branch from the repo at `root`, as for a Session that never committed to it.
    deleteBranch(
      root: string,
      branch: string,
    ): Effect.Effect<void, WorktreeError>;
    // Removes the worktree at `path`, made from the repo at `root`, keeping its branch. With
    // uncommitted changes in it, git refuses unless `force`. One already deleted by hand is only
    // forgotten.
    remove(
      root: string,
      path: string,
      options: { readonly force: boolean },
    ): Effect.Effect<void, WorktreeError>;
  }
>()("@repo/server/worktree/Worktrees") {
  static readonly layer = Layer.effect(
    Worktrees,
    Effect.gen(function* () {
      const git = yield* Git;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { dir } = yield* WorktreesDir;

      // The folder's real path, its repository's root, and the commit a branch would start from.
      const origin = Effect.fn("Worktrees.origin")(function* (root: string) {
        const real = yield* fs
          .realPath(root)
          .pipe(Effect.mapError(() => failed(`${root} doesn't exist`)));
        const top = yield* git.run(real, ["rev-parse", "--show-toplevel"]).pipe(
          Effect.map(trim),
          Effect.mapError(() => failed(`${root} isn't a git repository`)),
        );
        // `main` when there is one; otherwise whatever is checked out.
        const base = yield* git
          .run(top, ["rev-parse", "--verify", "-q", "refs/heads/main^{commit}"])
          .pipe(
            Effect.catch(() =>
              git.run(top, ["rev-parse", "--verify", "-q", "HEAD^{commit}"]),
            ),
            Effect.map(trim),
            Effect.mapError(() =>
              failed(`${root} has no commit to start a branch from`),
            ),
          );
        return { real, top, base };
      });

      const branchable = (root: string) =>
        origin(root).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );

      const create = Effect.fn("Worktrees.create")(function* (
        root: string,
        openingPrompt: string,
      ) {
        const { real, top, base } = yield* origin(root);
        const id = crypto.randomUUID().replaceAll("-", "").slice(0, 6);
        const branch = `${slug(openingPrompt)}-${id}`;
        const worktree = path.join(
          dir,
          "worktrees",
          path.basename(top),
          branch,
        );
        yield* git
          .run(top, ["worktree", "add", "-q", "-b", branch, worktree, base])
          .pipe(Effect.mapError((error) => failed(error.message)));
        return {
          projectRoot: root,
          branch,
          base,
          path: worktree,
          cwd: path.join(worktree, path.relative(top, real)),
        };
      });

      const isMerged = Effect.fn("Worktrees.isMerged")(
        function* (root: string, branch: string, base: string) {
          const commit = (ref: string) =>
            git
              .run(root, ["rev-parse", "--verify", "-q", `${ref}^{commit}`])
              .pipe(Effect.map(trim));
          const tip = yield* commit(`refs/heads/${branch}`);
          if (tip === base) return false;
          const main = yield* commit("refs/heads/main");
          const inHistory = yield* git
            .run(root, ["merge-base", "--is-ancestor", tip, main])
            .pipe(
              Effect.as(true),
              // Exit 1 means no; both refs exist, so that's the only failure left.
              Effect.orElseSucceed(() => false),
            );
          if (inHistory) return true;
          const [merged, mainTree] = yield* Effect.all([
            git
              .run(root, ["merge-tree", "--write-tree", main, tip])
              .pipe(Effect.map((out) => out.split("\n")[0]?.trim())),
            git
              .run(root, ["rev-parse", `${main}^{tree}`])
              .pipe(Effect.map(trim)),
          ]);
          return merged === mainTree;
        },
        // A deleted branch, no `main`, or a conflicting merge: not merged, as far as Fern can tell.
        Effect.orElseSucceed(() => false),
      );

      const hasCommits = Effect.fn("Worktrees.hasCommits")(
        function* (root: string, branch: string, base: string) {
          const tip = yield* git
            .run(root, [
              "rev-parse",
              "--verify",
              "-q",
              `refs/heads/${branch}^{commit}`,
            ])
            .pipe(Effect.map(trim));
          return tip !== base;
        },
        Effect.orElseSucceed(() => true),
      );

      const rename = Effect.fn("Worktrees.rename")(function* (
        worktree: string,
        branch: string,
        topic: string,
      ) {
        const id =
          /-([0-9a-f]{6})$/.exec(branch)?.[1] ??
          crypto.randomUUID().replaceAll("-", "").slice(0, 6);
        const renamed = `${slug(topic)}-${id}`;
        if (renamed === branch) return branch;
        yield* git
          .run(worktree, ["branch", "-m", branch, renamed])
          .pipe(Effect.mapError((error) => failed(error.message)));
        return renamed;
      });

      const deleteBranch = Effect.fn("Worktrees.deleteBranch")(function* (
        root: string,
        branch: string,
      ) {
        yield* git
          .run(root, ["branch", "-D", branch])
          .pipe(Effect.mapError((error) => failed(error.message)));
      });

      const exists = (worktree: string) =>
        fs.exists(worktree).pipe(Effect.orElseSucceed(() => true));

      const isDirty = Effect.fn("Worktrees.isDirty")(function* (
        worktree: string,
      ) {
        if (!(yield* exists(worktree))) return false;
        const status = yield* git
          .run(worktree, ["status", "--porcelain"])
          .pipe(Effect.mapError((error) => failed(error.message)));
        return status.trim() !== "";
      });

      const remove = Effect.fn("Worktrees.remove")(function* (
        root: string,
        worktree: string,
        { force }: { readonly force: boolean },
      ) {
        const args = (yield* exists(worktree))
          ? ["worktree", "remove", ...(force ? ["--force"] : []), worktree]
          : ["worktree", "prune"];
        yield* git
          .run(root, args)
          .pipe(Effect.mapError((error) => failed(error.message)));
      });

      return Worktrees.of({
        branchable,
        create,
        isMerged,
        hasCommits,
        rename,
        deleteBranch,
        isDirty,
        remove,
      });
    }),
  ).pipe(Layer.provide(Git.layer));
}
