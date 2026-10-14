import { WorktreeError } from "@repo/api";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Semaphore,
  SynchronizedRef,
} from "effect";
import { Git } from "../git/Git";
import { WorktreesDir } from "../worktree/Worktrees";

// A Foreign PR, by its repo on GitHub, as "owner/name", and its number.
export interface PrKey {
  readonly repo: string;
  readonly number: number;
}

// An owner's or a repo's name on GitHub, safe as a folder's name: never `.` or `..`.
const NAME = /^(?!\.\.?$)[A-Za-z0-9_.-]{1,100}$/;

const failed = (message: string) => new WorktreeError({ message });
const trim = (out: string) => out.trim();

// One worktree for each Foreign PR, outside the developer's checkout: detached, so nothing in it
// can be pushed to the PR's branch, and under Fern's worktrees folder at `prs/<owner>/<name>/<n>`,
// apart from Hosted Sessions' worktrees. The PR's Walkthrough writer reads in it, and Try it runs
// it, so whatever moves it or reads it goes one at a time for each PR.
export class PrWorktrees extends Context.Service<
  PrWorktrees,
  {
    // Where the PR's worktree is, whether or not it's there yet.
    path(pr: PrKey): Effect.Effect<string, WorktreeError>;
    // The PR's worktree, checked out detached at the commit: made from the repo the folder `root`
    // is in when there's none yet, or moved to the commit. One with changes not committed is
    // refused, as they would mix into what's read.
    checkout(
      root: string,
      pr: PrKey,
      commit: string,
    ): Effect.Effect<string, WorktreeError>;
    // Runs the effect while nothing else runs for the same PR.
    exclusive(
      pr: PrKey,
    ): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  }
>()("@repo/server/pullrequest/PrWorktrees") {
  static readonly layer = Layer.effect(
    PrWorktrees,
    Effect.gen(function* () {
      const git = yield* Git;
      const fs = yield* FileSystem.FileSystem;
      const paths = yield* Path.Path;
      const { dir } = yield* WorktreesDir;
      const locks = yield* SynchronizedRef.make(
        new Map<string, Semaphore.Semaphore>(),
      );

      const path = Effect.fn("PrWorktrees.path")(function* ({
        repo,
        number,
      }: PrKey) {
        const [owner, name, ...rest] = repo.split("/");
        if (
          owner === undefined ||
          name === undefined ||
          rest.length > 0 ||
          !NAME.test(owner) ||
          !NAME.test(name) ||
          !Number.isInteger(number) ||
          number <= 0
        )
          return yield* failed(
            `${repo}#${number} isn't a PR Fern can check out`,
          );
        return paths.join(dir, "prs", owner, name, String(number));
      });

      const run = (cwd: string, args: ReadonlyArray<string>) =>
        git.run(cwd, args).pipe(Effect.mapError((e) => failed(e.message)));

      const checkout = Effect.fn("PrWorktrees.checkout")(function* (
        root: string,
        pr: PrKey,
        commit: string,
      ) {
        const worktree = yield* path(pr);
        if (
          yield* fs.exists(worktree).pipe(Effect.orElseSucceed(() => false))
        ) {
          const status = yield* run(worktree, ["status", "--porcelain"]);
          if (status.trim() !== "")
            return yield* failed(
              `PR #${pr.number}'s worktree has changes not committed. Commit or discard them first.`,
            );
          yield* run(worktree, ["checkout", "-q", "--detach", commit]);
          return worktree;
        }
        const top = yield* run(root, ["rev-parse", "--show-toplevel"]).pipe(
          Effect.map(trim),
        );
        // A worktree deleted by hand is still registered until pruned, which would refuse it.
        yield* run(top, ["worktree", "prune"]);
        yield* run(top, [
          "worktree",
          "add",
          "-q",
          "--detach",
          worktree,
          commit,
        ]);
        return worktree;
      });

      const lockOf = (pr: PrKey) =>
        SynchronizedRef.modifyEffect(locks, (held) => {
          const key = `${pr.repo}#${pr.number}`;
          const found = held.get(key);
          if (found) return Effect.succeed([found, held] as const);
          return Semaphore.make(1).pipe(
            Effect.map((made) => [made, new Map(held).set(key, made)] as const),
          );
        });

      const exclusive =
        (pr: PrKey) =>
        <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          lockOf(pr).pipe(
            Effect.flatMap((lock) => lock.withPermits(1)(effect)),
          );

      return PrWorktrees.of({ path, checkout, exclusive });
    }),
  ).pipe(Layer.provide(Git.layer));
}
