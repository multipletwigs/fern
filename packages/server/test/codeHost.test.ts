import { assert, layer } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
    case "$4" in
      *pull_request=103) echo '[{"number":-7}]' ;;
      *) echo '[{"number":7}]' ;;
    esac
    exit 0 ;;
  "auth status") [ "$3 $4" = "--hostname github.com" ] && exit 0; exit 1 ;;
  "stack --version") exit 0 ;;
  "repo view") echo '{"defaultBranchRef":{"name":"trunk"}}'; exit 0 ;;
  "stack merge")
    echo "✗ cannot merge the whole stack: pull request #101 is blocked" >&2
    exit 2 ;;
  "pr view")
    echo '{"mergeStateStatus":"BLOCKED","mergeable":"MERGEABLE","reviewDecision":"REVIEW_REQUIRED"}'
    exit 0 ;;
  "api repos/{owner}/{repo}/pulls/101") echo '{"merged_at":"2026-10-13T09:00:00Z"}'; exit 0 ;;
  "api repos/{owner}/{repo}/pulls/102") echo '{"merged_at":null}'; exit 0 ;;
esac
exit 1
`,
);
chmodSync(join(dir, "gh"), 0o755);

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
});
