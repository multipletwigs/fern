import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../repo.ts";
import type { Fixture, FixtureSource, Pr } from "./shape.ts";

// Gets the slot's clone ready for the gh shim. Each fixture PR becomes a commit on its base, made
// in the clone without touching its working tree, and is pushed to a bare repo in the slot folder
// as GitHub keeps a PR: its branch and `refs/pull/N/head`. The clone's `origin` then names the repo
// on GitHub over SSH, so Fern still finds it there, while git's SSH command for the clone answers
// from the bare repo: fetches of a PR and pushes never reach GitHub. Writes the fixture the shim
// serves, each PR with its commits and diff.

export const DEFAULT_FIXTURE = join(import.meta.dirname, "fixture.json");
const GIT_SSH = join(import.meta.dirname, "git-ssh");
// Every fixture commit is made at this time, by its PR's author.
const AT = "2026-10-12T09:00:00Z";

// "owner/name" of an `origin` on GitHub, as Fern reads it.
const ON_GITHUB =
  /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

// The file at the commit; empty when it has none.
const fileAt = (clone: string, commit: string, path: string) => {
  const shown = spawnSync("git", ["cat-file", "blob", `${commit}:${path}`], {
    cwd: clone,
    encoding: "utf8",
  });
  return shown.status === 0 ? shown.stdout : "";
};

// The patch of each file the commit changes from its base, from its first hunk on, as GitHub's
// PR files have it.
const filesOf = (clone: string, base: string, head: string) =>
  git(clone, ["diff", "--name-only", base, head])
    .split("\n")
    .filter((path) => path !== "")
    .map((path) => {
      const diff = git(clone, [
        "diff",
        "--no-color",
        "--no-ext-diff",
        base,
        head,
        "--",
        path,
      ]);
      const hunks = diff.indexOf("@@");
      return { path, patch: hunks === -1 ? "" : diff.slice(hunks) };
    });

export const setUpGhShim = ({
  fixturePath,
  origin,
  clone,
  remote,
  served,
}: {
  readonly fixturePath: string;
  readonly origin: string | undefined;
  readonly clone: string;
  readonly remote: string;
  readonly served: string;
}) => {
  const source: FixtureSource = JSON.parse(readFileSync(fixturePath, "utf8"));
  const found = ON_GITHUB.exec(origin ?? "");
  const repo = found ? `${found[1]}/${found[2]}` : "fern-verify/fixture";
  const main = git(clone, ["rev-parse", "HEAD"]);

  // The commit of each branch: the default branch is the clone's HEAD.
  const commits = new Map([[source.defaultBranch, main]]);
  const index = join(remote, "..", "gh-shim.index");
  let pending = [...source.prs];
  const prs: Array<Pr> = [];
  while (pending.length > 0) {
    const ready = pending.filter((pr) => commits.has(pr.base));
    if (ready.length === 0) {
      console.error(
        `The gh shim fixture's PRs ${pending.map((pr) => `#${pr.number}`).join(", ")} are based on branches no PR or ${source.defaultBranch} has.`,
      );
      process.exit(1);
    }
    for (const pr of ready) {
      const base = commits.get(pr.base) ?? main;
      const env = {
        ...process.env,
        GIT_INDEX_FILE: index,
        GIT_AUTHOR_NAME: pr.author,
        GIT_AUTHOR_EMAIL: `${pr.author}@users.noreply.github.com`,
        GIT_AUTHOR_DATE: AT,
        GIT_COMMITTER_NAME: pr.author,
        GIT_COMMITTER_EMAIL: `${pr.author}@users.noreply.github.com`,
        GIT_COMMITTER_DATE: AT,
      };
      git(clone, ["read-tree", base], { env });
      for (const edit of pr.edits) {
        const content =
          "content" in edit
            ? edit.content
            : fileAt(clone, base, edit.path) + edit.append;
        const blob = git(clone, ["hash-object", "-w", "--stdin"], {
          input: content,
        });
        git(
          clone,
          [
            "update-index",
            "--add",
            "--cacheinfo",
            `100644,${blob},${edit.path}`,
          ],
          { env },
        );
      }
      const tree = git(clone, ["write-tree"], { env });
      const head = git(
        clone,
        ["commit-tree", tree, "-p", base, "-m", pr.title],
        { env },
      );
      commits.set(pr.head, head);
      const url = `https://github.com/${repo}/pull/${pr.number}`;
      prs.push({
        ...pr,
        state: pr.state ?? "OPEN",
        draft: pr.draft ?? false,
        reviewers: pr.reviewers ?? [],
        closes: pr.closes ?? [],
        url,
        headCommit: head,
        baseCommit: base,
        files: filesOf(clone, base, head),
        reviews: (pr.reviews ?? []).map((review, i) => {
          const id = pr.number * 100 + i;
          return {
            ...review,
            id,
            commit: head,
            url: `${url}#pullrequestreview-${id}`,
            submittedAt: AT,
          };
        }),
      });
    }
    pending = pending.filter((pr) => !ready.includes(pr));
  }
  rmSync(index, { force: true });

  git(clone, ["init", "--quiet", "--bare", remote]);
  git(clone, [
    "push",
    "--quiet",
    remote,
    `${main}:refs/heads/${source.defaultBranch}`,
    ...prs.flatMap((pr) => [
      `${pr.headCommit}:refs/heads/${pr.head}`,
      `${pr.headCommit}:refs/pull/${pr.number}/head`,
    ]),
  ]);
  // Run by the shell, so the paths are quoted: the worktree's may have spaces.
  git(clone, ["config", "core.sshCommand", `'${GIT_SSH}' '${remote}'`]);
  git(clone, ["config", "ssh.variant", "simple"]);
  git(clone, ["remote", "set-url", "origin", `git@github.com:${repo}.git`]);

  const fixture: Fixture = { ...source, repo, prs };
  writeFileSync(served, JSON.stringify(fixture, null, 2));
  return fixture;
};
