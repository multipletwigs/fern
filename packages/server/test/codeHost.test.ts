import { assert, layer } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeHost } from "../src/codehost/CodeHost";

// A stub `gh` that logs each call's arguments and answers as GitHub would for a Stack, number 7,
// whose PRs need an approving review before they merge: `gh stack merge` refuses, `gh pr merge`
// merges. PR #103 is in a Stack whose number isn't one, and the repo's default branch is `trunk`.
// `gh` is signed in to github.com, but not to a stale second host, so `gh auth status` alone fails.
// Only shell builtins work inside it, as PATH is its folder alone.
const dir = mkdtempSync(join(tmpdir(), "fern-gh-"));
const log = join(dir, "calls.log");
writeFileSync(
  join(dir, "gh"),
  `#!/bin/sh
echo "$@" >> "${log}"
case "$1 $2" in
  "pr ready"|"pr merge") exit 0 ;;
  "api -H")
    case "$PWD" in
      *-nostacks) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;
    esac
    case "$4" in
      *pull_request=103) echo '[{"number":-7}]' ;;
      *"stacks?per_page=100&page=1")
        printf '[{"id":902,"number":2,"pull_requests":[{"number":201},{"number":202}]},{"id":901,"number":1,"pull_requests":[{"number":200}]}'
        i=0
        while [ $i -lt 98 ]; do
          printf ',{"id":%d,"number":%d,"pull_requests":[]}' $((1000 + i)) $((10 + i))
          i=$((i + 1))
        done
        echo ']' ;;
      *"stacks?per_page=100&page=2") echo '[{"id":900,"number":0,"pull_requests":[{"number":203}]}]' ;;
      *) echo '[{"number":7}]' ;;
    esac
    exit 0 ;;
  "api user") echo "octocat"; exit 0 ;;
  "pr list")
    case "$PWD" in
      *-refused) echo "HTTP 403: API rate limit exceeded for user ID 1." >&2; exit 1 ;;
    esac
    echo '[{"number":202,"url":"https://github.com/acme/app/pull/202","title":"Toggle","author":{"login":"monalisa","is_bot":false},"headRefName":"toggle","baseRefName":"theme","headRefOid":"bbbb","isDraft":true,"state":"OPEN","reviewRequests":[{"__typename":"User","login":"octocat"},{"__typename":"Team","name":"Core","slug":"core"}]},{"number":201,"url":"https://github.com/acme/app/pull/201","title":"Theme","author":{"login":"hubot"},"headRefName":"theme","baseRefName":"main","headRefOid":"aaaa","isDraft":false,"state":"OPEN","reviewRequests":[]}]'
    exit 0 ;;
  "auth status") [ "$3 $4" = "--hostname github.com" ] && exit 0; exit 1 ;;
  "stack --version") exit 0 ;;
  "repo view") echo '{"defaultBranchRef":{"name":"trunk"}}'; exit 0 ;;
  "stack merge")
    echo "✗ cannot merge the whole stack: pull request #101 is blocked" >&2
    exit 2 ;;
  "pr view")
    case "$3" in
      77) echo '{"number":77,"url":"https://github.com/acme/app/pull/77","title":"Dark mode","body":"Adds it.","author":{"login":"monalisa"},"headRefName":"dark","baseRefName":"main","headRefOid":"cccc","isDraft":false,"state":"OPEN","reviewRequests":[],"closingIssuesReferences":[{"number":70,"url":"https://github.com/acme/app/issues/70"}]}' ;;
      78) echo '{"number":78,"url":"https://github.com/acme/app/pull/78","title":"Typo","body":"","author":null,"headRefName":"typo","baseRefName":"main","headRefOid":"dddd","isDraft":true,"state":"MERGED","reviewRequests":[],"closingIssuesReferences":[]}' ;;
      *) echo '{"mergeStateStatus":"BLOCKED","mergeable":"MERGEABLE","reviewDecision":"REVIEW_REQUIRED"}' ;;
    esac
    exit 0 ;;
  "issue view") echo '{"number":70,"title":"Themes","body":"We want themes."}'; exit 0 ;;
  "api repos/{owner}/{repo}/pulls/101") echo '{"merged_at":"2026-10-13T09:00:00Z"}'; exit 0 ;;
  "api repos/{owner}/{repo}/pulls/102") echo '{"merged_at":null}'; exit 0 ;;
esac
exit 1
`,
);
chmodSync(join(dir, "gh"), 0o755);
// A stub `git` that only logs, for the calls the code host makes through git.
writeFileSync(
  join(dir, "git"),
  `#!/bin/sh
echo "git $@" >> "${log}"
exit 0
`,
);
chmodSync(join(dir, "git"), 0o755);

const calls = () =>
  readFileSync(log, { encoding: "utf8", flag: "a+" })
    .split("\n")
    .filter((line) => line !== "");

// With PATH set to the stub's folder while the code host runs.
const withStub = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const path = process.env.PATH;
      process.env.PATH = dir;
      writeFileSync(log, "");
      return path;
    }),
    () => effect,
    (path) =>
      Effect.sync(() => {
        process.env.PATH = path;
      }),
  );

// A folder of its own for the code host to run in, named so the stub answers differently there.
const inFolder = (suffix: string) => {
  const path = `${mkdtempSync(join(tmpdir(), "fern-gh-cwd-"))}${suffix}`;
  mkdirSync(path);
  return path;
};

// The call for one page of the repo's Stacks.
const page = (n: number) =>
  `api -H X-GitHub-Api-Version: 2026-03-10 repos/{owner}/{repo}/stacks?per_page=100&page=${n}`;

const pr = (number: number) => ({
  number,
  url: `https://github.com/acme/app/pull/${number}`,
});

layer(CodeHost.layer.pipe(Layer.provide(NodeServices.layer)), {
  excludeTestServices: true,
})("CodeHost on GitHub", (it) => {
  it.effect(
    "a refused Stack merge fails with GitHub's reason in plain words, and what stops each PR",
    () =>
      withStub(
        Effect.gen(function* () {
          const host = yield* CodeHost;
          const refused = yield* host
            .merge("/", [pr(101), pr(102)])
            .pipe(Effect.flip);

          assert.strictEqual(refused._tag, "MergeRefused");
          assert.strictEqual(
            refused._tag === "MergeRefused" ? refused.reason : "",
            "Cannot merge the whole stack: pull request #101 is blocked. PR #101 needs an approving review. PR #102 needs an approving review.",
          );
          assert.include(calls(), "stack merge 7 --squash --yes");
          assert.isFalse(calls().some((call) => call.includes("--admin")));
        }),
      ),
  );

  it.effect(
    "a Stack of one PR is marked ready and merged on its own, as gh-stack merges no PR outside a Stack",
    () =>
      withStub(
        Effect.gen(function* () {
          const host = yield* CodeHost;
          yield* host.markReady("/", [pr(101)]);
          yield* host.merge("/", [pr(101)]);

          assert.deepStrictEqual(calls(), [
            "pr ready 101",
            "pr merge 101 --squash",
          ]);
        }),
      ),
  );

  it.effect("a Stack has merged once every one of its PRs has", () =>
    withStub(
      Effect.gen(function* () {
        const host = yield* CodeHost;
        const one = yield* host.state("/", [pr(101)]);
        const both = yield* host.state("/", [pr(101), pr(102)]);

        assert.isTrue(one.merged);
        assert.isFalse(both.merged);
      }),
    ),
  );

  it.effect(
    "gh is ready when it's signed in to github.com, whatever other host it has a stale login for",
    () =>
      withStub(
        Effect.gen(function* () {
          const host = yield* CodeHost;
          const ready = yield* host.ready("/");

          assert.isTrue(ready);
          assert.include(calls(), "auth status --hostname github.com");
        }),
      ),
  );

  it.effect(
    "a Stack number from GitHub that isn't a positive whole number is never passed to gh-stack",
    () =>
      withStub(
        Effect.gen(function* () {
          const host = yield* CodeHost;
          const failed = yield* host
            .merge("/", [pr(103), pr(104)])
            .pipe(Effect.flip);

          assert.strictEqual(failed._tag, "CodeHostError");
          assert.isFalse(
            calls().some((call) => call.startsWith("stack merge")),
          );
        }),
      ),
  );

  it.effect("the repo's default branch is GitHub's", () =>
    withStub(
      Effect.gen(function* () {
        const host = yield* CodeHost;
        assert.strictEqual(yield* host.defaultBranch("/"), "trunk");
      }),
    ),
  );

  it.effect("the login is the one gh is signed in as", () =>
    withStub(
      Effect.gen(function* () {
        const host = yield* CodeHost;
        assert.strictEqual(yield* host.login("/"), "octocat");
      }),
    ),
  );

  it.effect(
    "the repo's open PRs are listed with what GitHub says of each, and the people asked to review them",
    () =>
      withStub(
        Effect.gen(function* () {
          const host = yield* CodeHost;
          const prs = yield* host.pullRequests("/");

          assert.deepStrictEqual(prs, [
            {
              number: 202,
              url: "https://github.com/acme/app/pull/202",
              title: "Toggle",
              author: "monalisa",
              headRef: "toggle",
              baseRef: "theme",
              headCommit: "bbbb",
              draft: true,
              state: "open",
              reviewers: ["octocat"],
            },
            {
              number: 201,
              url: "https://github.com/acme/app/pull/201",
              title: "Theme",
              author: "hubot",
              headRef: "theme",
              baseRef: "main",
              headCommit: "aaaa",
              draft: false,
              state: "open",
              reviewers: [],
            },
          ]);
          assert.match(
            calls()[0] ?? "",
            /^pr list --state open --limit \d+ --json /,
          );
        }),
      ),
  );

  it.effect("GitHub refusing to list the PRs says why, in plain words", () =>
    withStub(
      Effect.gen(function* () {
        const host = yield* CodeHost;
        const failed = yield* host
          .pullRequests(inFolder("-refused"))
          .pipe(Effect.flip);
        assert.strictEqual(
          failed.message,
          "API rate limit exceeded for user ID 1.",
        );
      }),
    ),
  );

  it.effect(
    "Stacks are read a page at a time, newest first, only until every PR asked about is found",
    () =>
      withStub(
        Effect.gen(function* () {
          const host = yield* CodeHost;

          const newest = yield* host.stacks("/", [201]);
          assert.deepStrictEqual(newest.slice(0, 2), [
            { id: 902, number: 2, prs: [201, 202] },
            { id: 901, number: 1, prs: [200] },
          ]);
          assert.lengthOf(newest, 100);
          assert.deepStrictEqual(calls(), [page(1)]);

          writeFileSync(log, "");
          const older = yield* host.stacks("/", [202, 203]);
          assert.deepStrictEqual(older.at(-1), {
            id: 900,
            number: 0,
            prs: [203],
          });
          assert.deepStrictEqual(calls(), [page(1), page(2)]);

          // A page short of a hundred is the last.
          writeFileSync(log, "");
          yield* host.stacks("/", [999]);
          assert.deepStrictEqual(calls(), [page(1), page(2)]);
        }),
      ),
  );

  it.effect(
    "one PR comes with its author's description and the issue it says it closes",
    () =>
      withStub(
        Effect.gen(function* () {
          const host = yield* CodeHost;
          const found = yield* host.pullRequest("/", 77);

          assert.deepStrictEqual(found, {
            number: 77,
            url: "https://github.com/acme/app/pull/77",
            title: "Dark mode",
            author: "monalisa",
            headRef: "dark",
            baseRef: "main",
            headCommit: "cccc",
            draft: false,
            state: "open",
            reviewers: [],
            body: "Adds it.",
            issue: { number: 70, title: "Themes", body: "We want themes." },
          });
          assert.match(calls()[0] ?? "", /^pr view 77 --json /);
          assert.strictEqual(
            calls()[1],
            "issue view https://github.com/acme/app/issues/70 --json number,title,body",
          );

          writeFileSync(log, "");
          const unlinked = yield* host.pullRequest("/", 78);
          assert.deepStrictEqual(
            [unlinked.state, unlinked.author, unlinked.issue],
            ["merged", "ghost", undefined],
          );
          assert.lengthOf(calls(), 1);
        }),
      ),
  );

  it.effect(
    "a PR's head is fetched as GitHub keeps it, a fork's PR too, into hidden refs that leave the checkout alone",
    () =>
      withStub(
        Effect.gen(function* () {
          const host = yield* CodeHost;
          yield* host.fetchPullRequest("/", { number: 77, base: "main" });

          assert.deepStrictEqual(calls(), [
            "git fetch --quiet --no-tags --no-write-fetch-head origin +refs/pull/77/head:refs/fern/prs/77/head +refs/heads/main:refs/fern/prs/77/base",
          ]);

          writeFileSync(log, "");
          const flag = yield* host
            .fetchPullRequest("/", { number: 77, base: "--upload-pack=x" })
            .pipe(Effect.flip);
          assert.strictEqual(flag._tag, "CodeHostError");
          assert.deepStrictEqual(calls(), []);
        }),
      ),
  );

  it.effect("a repo without Stacks has none", () =>
    withStub(
      Effect.gen(function* () {
        const host = yield* CodeHost;
        assert.deepStrictEqual(
          yield* host.stacks(inFolder("-nostacks"), [1]),
          [],
        );
      }),
    ),
  );
});
