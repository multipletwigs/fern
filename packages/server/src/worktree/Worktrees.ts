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
    // A new branch from the tip of `main`, named after the opening prompt plus a short id, checked
    // out in a new worktree under Fern's app data.
    create(
      root: string,
      openingPrompt: string,
    ): Effect.Effect<Worktree, WorktreeError>;
  }
>()("@repo/server/worktree/Worktrees") {
  static readonly layer = Layer.effect(
    Worktrees,
    Effect.gen(function* () {
      const git = yield* Git;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { dir } = yield* WorktreesDir;

      const create = Effect.fn("Worktrees.create")(function* (
        root: string,
        openingPrompt: string,
      ) {
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

      return Worktrees.of({ create });
    }),
  ).pipe(Layer.provide(Git.layer));
}
