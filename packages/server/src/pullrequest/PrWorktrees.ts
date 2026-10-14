import { WorktreeError } from "@repo/api";
import {
  Cache,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Semaphore,
  SynchronizedRef,
} from "effect";
import { createHash } from "node:crypto";
import { Git } from "../git/Git";
import { WorktreesDir } from "../worktree/Worktrees";

// A Foreign PR, as one Project has it: the Project's folder, the PR's repo on GitHub, as
// "owner/name", and its number. Two Projects that are clones of the same repo each have their own.
export interface PrKey {
  readonly root: string;
  readonly repo: string;
  readonly number: number;
}

// An owner's or a repo's name on GitHub, safe as a folder's name: never `.` or `..`.
const NAME = /^(?!\.\.?$)[A-Za-z0-9_.-]{1,100}$/;

const failed = (message: string) => new WorktreeError({ message });
const trim = (out: string) => out.trim();

// Git config that runs no hooks: there's never one at /dev/null.
const NO_HOOKS = ["-c", "core.hooksPath=/dev/null"];

// One worktree for each Foreign PR of each Project, outside the developer's checkout: detached, so
// nothing in it can be pushed to the PR's branch, and under Fern's worktrees folder at
// `prs/<repo>/<owner>/<name>/<n>`, apart from Hosted Sessions' worktrees, where `<repo>` stands for
// the Project's own repo on disk. The PR's Walkthrough writer reads in it, and Try it runs it, so
// whatever moves it or reads it goes one at a time for each PR.
export class PrWorktrees extends Context.Service<
  PrWorktrees,
  {
    // Where the PR's worktree is, whether or not it's there yet.
    path(pr: PrKey): Effect.Effect<string, WorktreeError>;
    // The PR's worktree, checked out detached at the commit: made from the Project's repo when
    // there's none yet, or moved to the commit. One with changes not committed is refused, as they
    // would mix into what's read.
    checkout(pr: PrKey, commit: string): Effect.Effect<string, WorktreeError>;
    // The commit the PR's worktree is checked out at, when it has one.
    head(pr: PrKey): Effect.Effect<Option.Option<string>, WorktreeError>;
    // Whether the PR's worktree has changes not committed, files git doesn't know included. False
    // when it has none.
    isDirty(pr: PrKey): Effect.Effect<boolean, WorktreeError>;
    // The numbers of the repo's PRs that have a worktree in the Project at `root`.
    checkedOut(
      root: string,
      repo: string,
    ): Effect.Effect<ReadonlyArray<number>>;
    // Removes the PR's worktree, with any changes not committed when `force`, else refusing them.
    // Nothing to do when it has none.
    remove(
      pr: PrKey,
      options: { readonly force: boolean },
    ): Effect.Effect<void, WorktreeError>;
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

      // The folder for the PRs of the Project at `root`: named for its repo on disk, the git
      // folder its checkouts share, so a second clone of the same GitHub repo gets its own.
      const projectFolder = yield* Cache.make({
        capacity: 1024,
        timeToLive: "1 hour",
        lookup: (root: string) =>
          git
            .run(root, [
              "rev-parse",
              "--path-format=absolute",
              "--git-common-dir",
            ])
            .pipe(
              Effect.map(trim),
              Effect.flatMap((common) => fs.realPath(common)),
              Effect.map((common) =>
                paths.join(
                  dir,
                  "prs",
                  createHash("sha256")
                    .update(common)
                    .digest("hex")
                    .slice(0, 16),
                ),
              ),
              Effect.mapError((e) => failed(e.message)),
            ),
      });

      const repoFolder = Effect.fn("PrWorktrees.repoFolder")(function* (
        root: string,
        repo: string,
      ) {
        const [owner, name, ...rest] = repo.split("/");
        if (
          owner === undefined ||
          name === undefined ||
          rest.length > 0 ||
          !NAME.test(owner) ||
          !NAME.test(name)
        )
          return yield* failed(`${repo} isn't a repo Fern can check out`);
        return paths.join(yield* Cache.get(projectFolder, root), owner, name);
      });

      const path = Effect.fn("PrWorktrees.path")(function* ({
        root,
        repo,
        number,
      }: PrKey) {
        if (!Number.isInteger(number) || number <= 0)
          return yield* failed(
            `${repo}#${number} isn't a PR Fern can check out`,
          );
        return paths.join(yield* repoFolder(root, repo), String(number));
      });

      // The config for every git call on a PR's worktree, or one that checks a PR out: no hooks,
      // and none of the filters the developer has set up, such as git-lfs's. A hooks path that's
      // relative, as husky sets it, is read in the worktree git runs in, among the PR's own
      // files, so the PR could bring hooks that run as it's checked out. The PR's own
      // .gitattributes choose which filter runs on which file, and a filter runs a command, so
      // checking it out, or asking its worktree's status, would run them at its say-so. Its files
      // are checked out as committed.
      const guard = (root: string) =>
        git.run(root, ["config", "--get-regexp", "^filter\\."]).pipe(
          // None set: git exits 1.
          Effect.orElseSucceed(() => ""),
          Effect.map((out) => {
            const names = new Set(
              out
                .split("\n")
                .map((line) => line.split(" ")[0] ?? "")
                .filter((key) => key.startsWith("filter."))
                .map((key) =>
                  key.slice("filter.".length, key.lastIndexOf(".")),
                ),
            );
            return [
              ...NO_HOOKS,
              ...[...names].flatMap((name) => [
                "-c",
                `filter.${name}.smudge=`,
                "-c",
                `filter.${name}.clean=`,
                "-c",
                `filter.${name}.process=`,
                "-c",
                `filter.${name}.required=false`,
              ]),
            ];
          }),
        );

      // Runs git in `cwd`, guarded by the config of the Project at `root`.
      const run = (root: string, cwd: string, args: ReadonlyArray<string>) =>
        guard(root).pipe(
          Effect.flatMap((off) => git.run(cwd, [...off, ...args])),
          Effect.mapError((e) => failed(e.message)),
        );

      const exists = (folder: string) =>
        fs.exists(folder).pipe(Effect.orElseSucceed(() => false));

      const head = Effect.fn("PrWorktrees.head")(function* (pr: PrKey) {
        const worktree = yield* path(pr);
        if (!(yield* exists(worktree))) return Option.none<string>();
        return Option.some(
          yield* run(pr.root, worktree, ["rev-parse", "HEAD"]).pipe(
            Effect.map(trim),
          ),
        );
      });

      const isDirty = Effect.fn("PrWorktrees.isDirty")(function* (pr: PrKey) {
        const worktree = yield* path(pr);
        if (!(yield* exists(worktree))) return false;
        const status = yield* run(pr.root, worktree, ["status", "--porcelain"]);
        return status.trim() !== "";
      });

      const checkedOut = (root: string, repo: string) =>
        Effect.gen(function* () {
          const names = yield* fs.readDirectory(yield* repoFolder(root, repo));
          return names
            .filter((n) => /^[1-9][0-9]{0,9}$/.test(n))
            .map(Number)
            .toSorted((a, b) => a - b);
        }).pipe(Effect.orElseSucceed((): ReadonlyArray<number> => []));

      // The Project's checkout, which every worktree of its repo is made from and removed by.
      const topOf = (root: string) =>
        run(root, root, ["rev-parse", "--show-toplevel"]).pipe(
          Effect.map(trim),
        );

      const remove = Effect.fn("PrWorktrees.remove")(function* (
        pr: PrKey,
        { force }: { readonly force: boolean },
      ) {
        const worktree = yield* path(pr);
        if (!(yield* exists(worktree))) return;
        yield* run(pr.root, yield* topOf(pr.root), [
          "worktree",
          "remove",
          ...(force ? ["--force"] : []),
          worktree,
        ]);
      });

      const checkout = Effect.fn("PrWorktrees.checkout")(function* (
        pr: PrKey,
        commit: string,
      ) {
        const worktree = yield* path(pr);
        if (yield* exists(worktree)) {
          const status = yield* run(pr.root, worktree, [
            "status",
            "--porcelain",
          ]);
          if (status.trim() !== "")
            return yield* failed(
              `PR #${pr.number}'s worktree has changes not committed. Commit or discard them first.`,
            );
          yield* run(pr.root, worktree, ["checkout", "-q", "--detach", commit]);
          return worktree;
        }
        const top = yield* topOf(pr.root);
        // A worktree deleted by hand is still registered until pruned, which would refuse it.
        yield* run(pr.root, top, ["worktree", "prune"]);
        yield* run(pr.root, top, [
          "worktree",
          "add",
          "-q",
          "--detach",
          worktree,
          commit,
        ]);
        return worktree;
      });

      // By the worktree's folder, or, for a PR Fern can't name one for, by the PR in its Project.
      const lockOf = (pr: PrKey) =>
        path(pr).pipe(
          Effect.orElseSucceed(() => `${pr.root}\0${pr.repo}#${pr.number}`),
          Effect.flatMap((key) =>
            SynchronizedRef.modifyEffect(locks, (held) => {
              const found = held.get(key);
              if (found) return Effect.succeed([found, held] as const);
              return Semaphore.make(1).pipe(
                Effect.map(
                  (made) => [made, new Map(held).set(key, made)] as const,
                ),
              );
            }),
          ),
        );

      const exclusive =
        (pr: PrKey) =>
        <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          lockOf(pr).pipe(
            Effect.flatMap((lock) => lock.withPermits(1)(effect)),
          );

      return PrWorktrees.of({
        path,
        checkout,
        head,
        isDirty,
        checkedOut,
        remove,
        exclusive,
      });
    }),
  ).pipe(Layer.provide(Git.layer));
}
