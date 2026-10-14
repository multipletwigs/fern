import { assert, layer } from "@effect/vitest";
import { FernApi, LiveRpcs, type Walkthrough } from "@repo/api";
import { DateTime, Effect, Layer, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { RpcTest } from "effect/rpc";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CodeHost,
  CodeHostError,
  type HostPullRequestDetail,
  type HostReview,
  prBaseRef,
  prHeadRef,
} from "../src/codehost/CodeHost";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import {
  type Draft,
  type ForeignWriteRequest,
  WalkthroughWriter,
} from "../src/walkthrough/WalkthroughWriter";
import { WorktreesDir } from "../src/worktree/Worktrees";
import { FakeIssues } from "./stubs";

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd, encoding: "utf8" },
  ).trim();

const configDir = mkdtempSync(join(tmpdir(), "fern-claude-"));
process.env.CLAUDE_CONFIG_DIR = configDir;
const dataDir = realpathSync(mkdtempSync(join(tmpdir(), "fern-data-")));

// The developer's checkout of acme/app, on `main`.
const project = () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "fern-repo-")));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(
    join(repo, "a.ts"),
    "one\ntwo\nthree\nfour\nfive\nsix\nseven\n",
  );
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Initial");
  git(repo, "remote", "add", "origin", "git@github.com:acme/app.git");
  // A Session ran there, so Fern knows it as a Project.
  const file = join(
    configDir,
    "projects",
    repo.replace(/[^a-zA-Z0-9]/g, "-"),
    `${crypto.randomUUID()}.jsonl`,
  );
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({
      type: "user",
      uuid: crypto.randomUUID(),
      parentUuid: null,
      sessionId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      cwd: repo,
      entrypoint: "cli",
      userType: "external",
      message: { role: "user", content: "Earlier work" },
    })}\n`,
  );
  return repo;
};

// A commit on top of `from` with the files, made as on someone else's machine.
const commitOn = (
  repo: string,
  from: string,
  files: Record<string, string>,
  removed: ReadonlyArray<string> = [],
) => {
  const elsewhere = join(mkdtempSync(join(tmpdir(), "fern-fork-")), "work");
  git(repo, "worktree", "add", "-q", "--detach", elsewhere, from);
  for (const [path, content] of Object.entries(files))
    writeFileSync(join(elsewhere, path), content);
  for (const path of removed) rmSync(join(elsewhere, path));
  git(elsewhere, "add", "-A");
  git(elsewhere, "commit", "-q", "-m", "Someone's work");
  const commit = git(elsewhere, "rev-parse", "HEAD");
  git(repo, "worktree", "remove", "--force", elsewhere);
  return commit;
};

// What GitHub has of the repo: each PR, and the commits its head and base branch are at.
const github = new Map<
  number,
  { pr: HostPullRequestDetail; head: string; base: string }
>();
const opened = (
  number: number,
  at: { readonly head: string; readonly base: string },
  init: Partial<HostPullRequestDetail> = {},
) => {
  github.set(number, {
    pr: {
      number,
      url: `https://github.com/acme/app/pull/${number}`,
      title: `PR ${number}`,
      author: "monalisa",
      headRef: `branch-${number}`,
      baseRef: "main",
      headCommit: at.head,
      draft: false,
      state: "open",
      reviewers: [],
      body: "",
      closes: undefined,
      ...init,
    },
    ...at,
  });
};
const moved = (number: number, init: Partial<HostPullRequestDetail>) => {
  const found = github.get(number);
  if (found) github.set(number, { ...found, pr: { ...found.pr, ...init } });
};

// Every review that reached GitHub, and, while `refusal` is set, GitHub refusing them so.
const posted: Array<{ cwd: string; pr: number; review: HostReview }> = [];
let refusal: string | undefined;

// The PR's diff as GitHub shows it: from where the PR leaves its base, a renamed file under its new
// name alone, with only the lines around its changes.
const diffOnGitHub = (cwd: string, number: number) => {
  const found = github.get(number);
  if (!found) throw new Error(`No PR #${number}`);
  const out = git(
    cwd,
    "diff",
    "-M",
    "--no-color",
    "--no-ext-diff",
    `${found.base}...${found.head}`,
  );
  return out
    .split(/^diff --git /mu)
    .slice(1)
    .map((file) => {
      const lines = file.split("\n");
      const named = (prefix: string) =>
        lines.find((l) => l.startsWith(prefix))?.slice(prefix.length);
      const to = named("+++ b/");
      const at = lines.findIndex((l) => l.startsWith("@@"));
      return {
        path: named("rename to ") ?? to ?? named("--- a/") ?? "",
        patch: at === -1 ? undefined : lines.slice(at).join("\n"),
      };
    });
};

// Whether GitHub can put a comment on that line of the PR's diff.
const onDiff = (
  files: ReturnType<typeof diffOnGitHub>,
  { path, line, side }: HostReview["comments"][number],
) => {
  const patch = files.find((f) => f.path === path)?.patch;
  let [left, right] = [0, 0];
  for (const text of patch?.split("\n") ?? []) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)/u.exec(text);
    if (header) {
      [left, right] = [Number(header[1]), Number(header[2])];
      continue;
    }
    const removed = text.startsWith("-");
    const added = text.startsWith("+");
    if (!removed && !added && !text.startsWith(" ")) continue;
    if (side === "LEFT" && !added && left === line) return true;
    if (side === "RIGHT" && !removed && right === line) return true;
    if (!added) left++;
    if (!removed) right++;
  }
  return false;
};

const FakeCodeHost = Layer.succeed(
  CodeHost,
  CodeHost.of({
    ready: () => Effect.succeed(true),
    defaultBranch: () => Effect.succeed("main"),
    push: () => Effect.die("unused"),
    openDraft: () => Effect.die("unused"),
    link: () => Effect.die("unused"),
    setBody: () => Effect.die("unused"),
    markReady: () => Effect.die("unused"),
    merge: () => Effect.die("unused"),
    state: () => Effect.die("unused"),
    login: () => Effect.succeed("octocat"),
    pullRequests: () =>
      Effect.sync(() => [...github.values()].map(({ pr }) => pr)),
    stacks: () => Effect.succeed([]),
    pullRequest: (_cwd, number) =>
      Effect.suspend(() => {
        const found = github.get(number);
        return found
          ? Effect.succeed(found.pr)
          : Effect.fail(new CodeHostError({ message: `No PR #${number}.` }));
      }),
    fetchPullRequest: (cwd, { number }) =>
      Effect.sync(() => {
        const found = github.get(number);
        if (!found) throw new Error(`No PR #${number}`);
        git(cwd, "update-ref", prHeadRef(number), found.head);
        git(cwd, "update-ref", prBaseRef(number), found.base);
      }),
    issue: () => Effect.die("unused"),
    commitsAhead: () => Effect.die("unused"),
    pullRequestDiff: (cwd, number) =>
      Effect.sync(() => diffOnGitHub(cwd, number)),
    postReview: (cwd, pr, review) =>
      Effect.suspend(() => {
        if (refusal !== undefined)
          return Effect.fail(new CodeHostError({ message: refusal }));
        const files = diffOnGitHub(cwd, pr);
        if (!review.comments.every((comment) => onDiff(files, comment)))
          return Effect.fail(
            new CodeHostError({ message: "Path could not be resolved." }),
          );
        posted.push({ cwd, pr, review });
        return Effect.succeed({
          url: `https://github.com/acme/app/pull/${pr}#pullrequestreview-${posted.length}`,
          postedAt: Date.parse("2026-10-14T09:30:00Z"),
        });
      }),
  }),
);

// The writer of Foreign PR Walkthroughs, faked: it answers with the Sections `answers` gives.
let answers: (request: ForeignWriteRequest) => Draft = () => ({
  sections: [],
  notFromSession: [],
});
const Writer = Layer.succeed(
  WalkthroughWriter,
  WalkthroughWriter.of({
    write: () => Effect.die("unused"),
    explore: (request) =>
      Effect.sync(() => {
        const draft = answers(request);
        return { draft, revise: () => Effect.succeed(draft) };
      }),
  }),
);

const hunkIn = (request: ForeignWriteRequest, path: string) =>
  request.hunks.find((hunk) => hunk.path === path)?.id ?? "";

const section = (title: string, hunks: ReadonlyArray<string>) => ({
  title,
  explanation: `${title}.`,
  hunks,
  decisions: [],
  risk: { level: "low" as const, reason: "Small." },
});

const makeClient = HttpApiTest.groups(FernApi, [
  "pullRequests",
  "walkthroughs",
]);
const makeLive = RpcTest.makeClient(LiveRpcs);

// The PR's latest Walkthrough, once there are `count`, none being written, and `ready` holds of
// it.
const walkthroughOf = (
  number: number,
  ready: (walkthrough: Walkthrough) => boolean = () => true,
  count = 1,
) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    const [walkthroughs] = yield* live
      .PullRequestWalkthroughs({ repo: "acme/app", number })
      .pipe(
        Stream.filter((all) => {
          const latest = all.at(-1);
          return (
            all.length === count &&
            all.every((w) => w.status !== "writing") &&
            latest !== undefined &&
            ready(latest)
          );
        }),
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("5 seconds"),
      );
    const walkthrough = walkthroughs?.at(-1);
    assert.isDefined(walkthrough);
    return walkthrough;
  });

// Walks through the PR again, for its `count`th Walkthrough.
const rewalked = (
  client: Effect.Success<typeof makeClient>,
  root: string,
  number: number,
  count: number,
) =>
  client.pullRequests
    .walkThrough({ params: { number }, payload: { root } })
    .pipe(Effect.andThen(walkthroughOf(number, () => true, count)));

// A PR changing `a.ts` and adding `b.ts` and `c.ts`, walked through: one Section for each of the
// first two, and `c.ts` left Unexplained.
const walkedThrough = (
  number: number,
  init: Partial<HostPullRequestDetail> = {},
  titles: readonly [string, string] = ["Shout five", "Add b"],
) =>
  Effect.gen(function* () {
    const root = project();
    const base = git(root, "rev-parse", "HEAD");
    const head = commitOn(root, base, {
      "a.ts": "one\ntwo\nthree\nfour\nFIVE\nsix\nseven\n",
      "b.ts": "export const b = 1;\nexport const c = 2;\n",
      "c.ts": "stray\n",
    });
    opened(number, { head, base }, init);
    answers = (request) => ({
      sections: [
        section(titles[0], [hunkIn(request, "a.ts")]),
        section(titles[1], [hunkIn(request, "b.ts")]),
      ],
      notFromSession: [],
    });
    const client = yield* makeClient;
    yield* client.pullRequests.walkThrough({
      params: { number },
      payload: { root },
    });
    const walkthrough = yield* walkthroughOf(number);
    return { root, head, walkthrough, client };
  });

// Gives every Section and Unexplained change of the Walkthrough a verdict: a Rejection with the
// note where `notes` has one, an approval elsewhere.
const judged = (walkthrough: Walkthrough, notes: Record<string, string> = {}) =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    const items = [
      ...walkthrough.sections.map((s) => s.id),
      ...walkthrough.unexplained.map((u) => u.hunk.id),
    ];
    for (const item of items) {
      const note = notes[item];
      yield* client.walkthroughs.verdict({
        params: { id: walkthrough.id, item },
        payload:
          note === undefined
            ? { kind: "approved" }
            : { kind: "rejected", note },
      });
    }
    return yield* walkthroughOf(
      walkthrough.foreignPr?.number ?? 0,
      (w) => w.reviewedAt !== undefined,
      walkthrough.number,
    );
  });

// A review comment's fields alone, to compare with what GitHub was sent.
const plain = (comment: HostReview["comments"][number]) => ({
  path: comment.path,
  line: comment.line,
  side: comment.side,
  body: comment.body,
});

const fern = Layer.mergeAll(
  handlersWith(Writer, FakeIssues, FakeCodeHost).pipe(
    Layer.provideMerge(DatabaseLive(join(dataDir, "fern.db"))),
    Layer.provide(Layer.succeed(WorktreesDir, { dir: dataDir })),
  ),
  HttpServer.layerServices,
);

layer(fern, { excludeTestServices: true })("Post review", (it) => {
  it.effect(
    "shows exactly the review it would post, and posts it only when asked: changes requested, every Rejection in the body, and each Section's note on its first changed line",
    () =>
      Effect.gen(function* () {
        const { root, head, walkthrough, client } = yield* walkedThrough(
          30,
          {},
          ["Shout `five`\n@acme/everyone", "Add b"],
        );
        const stray = walkthrough.unexplained[0]?.hunk.id ?? "";
        yield* judged(walkthrough, {
          s1: "five should stay quiet.\nReally.",
          s2: "Not yet.",
          [stray]: "Why is this here?",
        });

        const preview = yield* client.pullRequests.review({
          params: { number: 30 },
          query: { root, walkthrough: walkthrough.id },
        });
        assert.lengthOf(posted, 0);
        const expected = {
          commit: head,
          event: "REQUEST_CHANGES",
          body: [
            "Reviewed in Fern. Rejected:",
            "",
            "1. `` Shout `five` @acme/everyone ``",
            "",
            "   five should stay quiet.",
            "   Really.",
            "",
            "2. `Add b`",
            "",
            "   Not yet.",
            "",
            "3. Unexplained change in `c.ts`",
            "",
            "   Why is this here?",
          ].join("\n"),
          // The line `five` was on, as the PR removes it; the first line of `b.ts`, as it adds it.
          comments: [
            {
              path: "a.ts",
              line: 5,
              side: "LEFT",
              body: "five should stay quiet.\nReally.",
            },
            { path: "b.ts", line: 1, side: "RIGHT", body: "Not yet." },
          ],
        };
        assert.deepStrictEqual(
          {
            commit: preview.commit,
            event: preview.event,
            body: preview.body,
            comments: preview.comments.map(plain),
          },
          expected,
        );

        const review = yield* client.pullRequests.postReview({
          params: { number: 30 },
          payload: { root, walkthrough: walkthrough.id },
        });
        assert.deepStrictEqual(
          posted.map((p) => ({
            cwd: p.cwd,
            pr: p.pr,
            review: { ...p.review, comments: p.review.comments.map(plain) },
          })),
          [{ cwd: root, pr: 30, review: expected }],
        );
        assert.strictEqual(
          review.url,
          "https://github.com/acme/app/pull/30#pullrequestreview-1",
        );

        const shown = yield* walkthroughOf(30, (w) => w.review !== undefined);
        assert.deepStrictEqual(
          [
            shown.review?.url,
            shown.review && DateTime.toEpochMillis(shown.review.postedAt),
          ],
          [review.url, Date.parse("2026-10-14T09:30:00Z")],
        );

        // A Walkthrough's review goes up once.
        const again = yield* client.pullRequests
          .postReview({
            params: { number: 30 },
            payload: { root, walkthrough: walkthrough.id },
          })
          .pipe(Effect.flip);
        assert.deepStrictEqual(
          [again._tag, "url" in again ? again.url : undefined],
          ["ReviewPostedAlready", review.url],
        );
        assert.lengthOf(posted, 1);
      }),
  );

  it.effect(
    "approves when nothing was rejected, and only comments on the developer's own PR, which GitHub won't let them approve",
    () =>
      Effect.gen(function* () {
        const theirs = yield* walkedThrough(31);
        yield* judged(theirs.walkthrough);
        const approving = yield* theirs.client.pullRequests.review({
          params: { number: 31 },
          query: { root: theirs.root, walkthrough: theirs.walkthrough.id },
        });
        assert.deepStrictEqual(
          [approving.event, approving.body, approving.comments.length],
          ["APPROVE", "Reviewed in Fern: every change approved.", 0],
        );

        const mine = yield* walkedThrough(32, { author: "OctoCat" });
        yield* judged(mine.walkthrough);
        const approved = yield* mine.client.pullRequests.postReview({
          params: { number: 32 },
          payload: { root: mine.root, walkthrough: mine.walkthrough.id },
        });
        const rejectedToo = yield* walkedThrough(33, { author: "octocat" });
        yield* judged(rejectedToo.walkthrough, { s2: "Not yet." });
        yield* rejectedToo.client.pullRequests.postReview({
          params: { number: 33 },
          payload: {
            root: rejectedToo.root,
            walkthrough: rejectedToo.walkthrough.id,
          },
        });

        assert.deepStrictEqual(
          posted
            .filter((p) => p.pr === 32 || p.pr === 33)
            .map((p) => [p.pr, p.review.event, p.review.comments.length]),
          [
            [32, "COMMENT", 0],
            [33, "COMMENT", 1],
          ],
        );
        assert.include(approved.url, "/pull/32#");
      }),
  );

  it.effect(
    "nothing is posted for a Walkthrough still waiting on verdicts, or on a closed or merged PR",
    () =>
      Effect.gen(function* () {
        const before = posted.length;
        const { root, walkthrough, client } = yield* walkedThrough(34);
        const unreviewed = yield* client.pullRequests
          .postReview({
            params: { number: 34 },
            payload: { root, walkthrough: walkthrough.id },
          })
          .pipe(Effect.flip);
        assert.strictEqual(unreviewed._tag, "WalkthroughNotReviewed");

        yield* judged(walkthrough, { s1: "No." });
        for (const state of ["closed", "merged"] as const) {
          moved(34, { state });
          const closed = yield* client.pullRequests
            .postReview({
              params: { number: 34 },
              payload: { root, walkthrough: walkthrough.id },
            })
            .pipe(Effect.flip);
          assert.strictEqual(closed._tag, "PrNotOpen");
          const preview = yield* client.pullRequests
            .review({
              params: { number: 34 },
              query: { root, walkthrough: walkthrough.id },
            })
            .pipe(Effect.flip);
          assert.strictEqual(preview._tag, "PrNotOpen");
        }

        // Nor for another PR's Walkthrough.
        moved(34, { state: "open" });
        const elsewhere = yield* client.pullRequests
          .postReview({
            params: { number: 35 },
            payload: { root, walkthrough: walkthrough.id },
          })
          .pipe(Effect.flip);
        assert.strictEqual(elsewhere._tag, "WalkthroughNotFound");
        assert.strictEqual(posted.length, before);
      }),
  );

  it.effect(
    "a review of a Walkthrough of the PR's new commits puts each note on a line they add, never on one they remove",
    () =>
      Effect.gen(function* () {
        const { root, head, walkthrough, client } = yield* walkedThrough(37);
        yield* judged(walkthrough);

        // The author answers with a commit that rewrites `six` and takes a line of `b.ts` back out.
        const answer = commitOn(root, head, {
          "a.ts": "one\ntwo\nthree\nfour\nFIVE\nSIX\nseven\n",
          "b.ts": "export const b = 1;\n",
        });
        opened(37, { head: answer, base: git(root, "rev-parse", "main") });
        yield* client.pullRequests.walkThrough({
          params: { number: 37 },
          payload: { root },
        });
        const live = yield* makeLive;
        const [all] = yield* live
          .PullRequestWalkthroughs({ repo: "acme/app", number: 37 })
          .pipe(
            Stream.filter(
              (walkthroughs) =>
                walkthroughs.length === 2 &&
                walkthroughs.every((w) => w.status === "ready"),
            ),
            Stream.take(1),
            Stream.runCollect,
            Effect.timeout("5 seconds"),
          );
        const rerun = all?.[1];
        assert.isDefined(rerun);
        assert.strictEqual(rerun.since, "previous");
        for (const [item, note] of [
          ["s1", "Keep six quiet."],
          ["s2", "Keep c."],
        ] as const)
          yield* client.walkthroughs.verdict({
            params: { id: rerun.id, item },
            payload: { kind: "rejected", note },
          });

        const preview = yield* client.pullRequests.review({
          params: { number: 37 },
          query: { root, walkthrough: rerun.id },
        });
        // `six` became `SIX`: the note goes on `SIX`, as the PR adds it. The line taken out of
        // `b.ts` was never on the PR's base, so its note is only in the body.
        assert.deepStrictEqual(
          [
            preview.commit,
            preview.event,
            preview.comments.map(plain),
            preview.body.includes("Keep c."),
          ],
          [
            answer,
            "REQUEST_CHANGES",
            [{ path: "a.ts", line: 6, side: "RIGHT", body: "Keep six quiet." }],
            true,
          ],
        );
        yield* client.pullRequests.postReview({
          params: { number: 37 },
          payload: { root, walkthrough: rerun.id },
        });
        assert.deepStrictEqual(
          posted
            .filter((p) => p.pr === 37)
            .map((p) => [p.review.commit, p.review.comments.map(plain)]),
          [[answer, preview.comments.map(plain)]],
        );
      }),
  );

  it.effect(
    "a review GitHub refuses shows its reason on the Walkthrough, and goes up when tried again",
    () =>
      Effect.gen(function* () {
        const { root, walkthrough, client } = yield* walkedThrough(36);
        yield* judged(walkthrough, { s1: "No." });
        refusal = "Line could not be resolved.";
        const failed = yield* client.pullRequests
          .postReview({
            params: { number: 36 },
            payload: { root, walkthrough: walkthrough.id },
          })
          .pipe(Effect.flip);
        refusal = undefined;
        assert.deepStrictEqual(
          [failed._tag, "message" in failed ? failed.message : undefined],
          ["PullRequestsError", "Line could not be resolved."],
        );
        const refused = yield* walkthroughOf(
          36,
          (w) => w.reviewError !== undefined,
        );
        assert.deepStrictEqual(
          [refused.reviewError, refused.review],
          ["Line could not be resolved.", undefined],
        );

        yield* client.pullRequests.postReview({
          params: { number: 36 },
          payload: { root, walkthrough: walkthrough.id },
        });
        const up = yield* walkthroughOf(36, (w) => w.review !== undefined);
        assert.isUndefined(up.reviewError);
        assert.lengthOf(
          posted.filter((p) => p.pr === 36),
          1,
        );
      }),
  );

  it.effect(
    "a review of a Walkthrough of the PR's new commits still requests changes for Rejections in earlier ones never posted, unless a later Section fixes them",
    () =>
      Effect.gen(function* () {
        const { root, head, walkthrough, client } = yield* walkedThrough(39);
        yield* judged(walkthrough, {
          s1: "five should stay quiet.",
          s2: "Not yet.",
        });

        // The author answers the first Rejection, r1, and changes b again.
        const answer = commitOn(root, head, {
          "a.ts": "one\ntwo\nthree\nfour\nfive\nsix\nseven\n",
          "b.ts": "export const b = 1;\n",
        });
        opened(39, { head: answer, base: git(root, "rev-parse", "main") });
        answers = (request) => ({
          sections: [
            {
              ...section("Quiet five", [hunkIn(request, "a.ts")]),
              fixes: request.rejections[0]?.id,
            },
            section("Trim b", [hunkIn(request, "b.ts")]),
          ],
          notFromSession: [],
        });
        const second = yield* rewalked(client, root, 39, 2);
        assert.strictEqual(second.since, "previous");
        yield* judged(second);

        const preview = yield* client.pullRequests.review({
          params: { number: 39 },
          query: { root, walkthrough: second.id },
        });
        assert.deepStrictEqual(
          [preview.event, preview.body, preview.comments.length],
          [
            "REQUEST_CHANGES",
            [
              "Reviewed in Fern. Rejected:",
              "",
              "1. `Add b` (from Walkthrough 1)",
              "",
              "   Not yet.",
            ].join("\n"),
            0,
          ],
        );
        yield* client.pullRequests.postReview({
          params: { number: 39 },
          payload: { root, walkthrough: second.id },
        });

        // Once a review went up with them, they're not posted again.
        const third = commitOn(root, answer, { "c.ts": "gone\n" });
        opened(39, { head: third, base: git(root, "rev-parse", "main") });
        answers = (request) => ({
          sections: [section("Tidy c", [hunkIn(request, "c.ts")])],
          notFromSession: [],
        });
        const last = yield* rewalked(client, root, 39, 3);
        yield* judged(last);
        const approving = yield* client.pullRequests.review({
          params: { number: 39 },
          query: { root, walkthrough: last.id },
        });
        assert.strictEqual(approving.event, "APPROVE");
      }),
  );

  it.effect(
    "on a PR that renames a file, a note goes on a line only where GitHub's diff of the PR has it, and only in the body elsewhere",
    () =>
      Effect.gen(function* () {
        const root = project();
        const base = git(root, "rev-parse", "HEAD");
        // GitHub shows `a.ts` renamed to `moved.ts` with `five` changed; Fern's own diff has
        // `a.ts` removed and `moved.ts` added, every line of each.
        const head = commitOn(
          root,
          base,
          {
            "moved.ts": "one\ntwo\nthree\nfour\nFIVE\nsix\nseven\n",
            "b.ts": "export const b = 1;\n",
          },
          ["a.ts"],
        );
        opened(43, { head, base });
        answers = (request) => ({
          sections: [
            section("Drop a", [hunkIn(request, "a.ts")]),
            section("Add moved", [hunkIn(request, "moved.ts")]),
            section("Add b", [hunkIn(request, "b.ts")]),
          ],
          notFromSession: [],
        });
        const client = yield* makeClient;
        yield* client.pullRequests.walkThrough({
          params: { number: 43 },
          payload: { root },
        });
        const walkthrough = yield* walkthroughOf(43);
        yield* judged(walkthrough, {
          s1: "Keep a.",
          s2: "Not here.",
          s3: "Not yet.",
        });

        const preview = yield* client.pullRequests.review({
          params: { number: 43 },
          query: { root, walkthrough: walkthrough.id },
        });
        assert.deepStrictEqual(preview.comments.map(plain), [
          { path: "b.ts", line: 1, side: "RIGHT", body: "Not yet." },
        ]);
        for (const note of ["Keep a.", "Not here.", "Not yet."])
          assert.include(preview.body, note);

        yield* client.pullRequests.postReview({
          params: { number: 43 },
          payload: { root, walkthrough: walkthrough.id },
        });
        assert.deepStrictEqual(
          posted
            .filter((p) => p.pr === 43)
            .map((p) => p.review.comments.map(plain)),
          [preview.comments.map(plain)],
        );
      }),
  );
});
