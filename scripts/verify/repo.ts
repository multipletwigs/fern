import { spawnSync } from "node:child_process";

// Runs git, returning what it printed; exits the script with git's own words when it fails.
export const git = (
  cwd: string,
  args: ReadonlyArray<string>,
  options: { readonly input?: string; readonly env?: NodeJS.ProcessEnv } = {},
) => {
  const done = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    input: options.input,
    env: options.env ?? process.env,
  });
  if (done.status !== 0) {
    console.error(`git ${args.join(" ")} failed in ${cwd}:\n${done.stderr}`);
    process.exit(1);
  }
  return done.stdout.trim();
};

// Clones the worktree, at its checked-out commit, into `dest`, and points the clone's `origin` at
// the worktree's, so Fern finds the same repo on GitHub. The clone starts with no `refs/fern`, and
// work the worktree hasn't committed stays behind. The worktree's `origin`, if it has one.
export const cloneWorktree = (root: string, dest: string) => {
  const origin = spawnSync("git", ["config", "--get", "remote.origin.url"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
  git(root, ["clone", "--quiet", root, dest]);
  if (origin === "") return undefined;
  git(dest, ["remote", "set-url", "origin", origin]);
  return origin;
};
