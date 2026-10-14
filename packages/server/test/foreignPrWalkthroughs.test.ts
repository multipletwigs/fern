import { assert, layer } from "@effect/vitest";
import {
  FernApi,
  LiveRpcs,
  WalkthroughError,
  type Walkthrough,
} from "@repo/api";
import { Deferred, Effect, Layer, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { RpcTest } from "effect/rpc";
import { SqlClient } from "effect/sql";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CodeHost,
  CodeHostError,
  type HostPullRequestDetail,
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

// A Project on GitHub: the developer's checkout of acme/app, on `main` at its first commit, where
// they have run a Session, with work of their own not committed yet.
const project = () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "fern-repo-")));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Initial");
  git(repo, "remote", "add", "origin", "git@github.com:acme/app.git");
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
  writeFileSync(join(repo, "a.ts"), "export const a = 'mine';\n");
  writeFileSync(join(repo, "notes.txt"), "my notes\n");
  return repo;
};

// A commit on top of `from` with the files, made as on someone else's machine: no branch of the
// developer's reaches it, as with a PR from a fork.
const commitOn = (
  repo: string,
  from: string,
  files: Record<string, string>,
) => {
  const elsewhere = join(mkdtempSync(join(tmpdir(), "fern-fork-")), "work");
  git(repo, "worktree", "add", "-q", "--detach", elsewhere, from);
  for (const [path, content] of Object.entries(files))
    writeFileSync(join(elsewhere, path), content);
  git(elsewhere, "add", "-A");
  git(elsewhere, "commit", "-q", "-m", "Someone's work");
  const commit = git(elsewhere, "rev-parse", "HEAD");
  git(repo, "worktree", "remove", "--force", elsewhere);
  return commit;
};

// What GitHub has of the repo: each PR, and the commits its head and base branch are at.
interface OnGitHub {
  readonly pr: HostPullRequestDetail;
  readonly head: string;
  readonly base: string;
}
const github = new Map<number, OnGitHub>();
const fetched: Array<{ readonly cwd: string; readonly number: number }> = [];
const prOf = (
  number: number,
  init: Partial<HostPullRequestDetail> = {},
): HostPullRequestDetail => ({
  number,
  url: `https://github.com/acme/app/pull/${number}`,
  title: `PR ${number}`,
  author: "monalisa",
  headRef: `branch-${number}`,
  baseRef: "main",
  headCommit: "",
  draft: false,
  state: "open",
  reviewers: [],
  body: "",
  issue: undefined,
  ...init,
});
// Puts the PR on GitHub, at those commits.
const opened = (
  number: number,
  at: { readonly head: string; readonly base: string },
  init: Partial<HostPullRequestDetail> = {},
) => {
  github.set(number, {
    pr: prOf(number, { headCommit: at.head, ...init }),
    ...at,
  });
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
          : Effect.fail(
              new CodeHostError({
                message: `Could not resolve to a PullRequest with the number of ${number}.`,
              }),
            );
      }),
    // As `git fetch` of `pull/N/head` would: hidden refs, and nothing else.
    fetchPullRequest: (cwd, { number }) =>
      Effect.sync(() => {
        const found = github.get(number);
        if (!found) throw new Error(`No PR #${number}`);
        fetched.push({ cwd, number });
        git(cwd, "update-ref", prHeadRef(number), found.head);
        git(cwd, "update-ref", prBaseRef(number), found.base);
      }),
    postReview: () => Effect.die("unused"),
  }),
);

// The writer of Foreign PR Walkthroughs, faked: what it's asked, and what it answers, a first draft
// then its revision, once `gate` (if a test set one) opens. While `refusal` is set, it fails so.
const explored: Array<ForeignWriteRequest> = [];
const revisions: Array<ReadonlyArray<string>> = [];
let answers: (request: ForeignWriteRequest) => [Draft, Draft?] = () => [
  { sections: [], notFromSession: [] },
];
let gate: Deferred.Deferred<void> | undefined;
let refusal: string | undefined;
const Writer = Layer.succeed(
  WalkthroughWriter,
  WalkthroughWriter.of({
    write: () => Effect.die("unused"),
    explore: (request) =>
      Effect.gen(function* () {
        explored.push(request);
        if (gate) yield* Deferred.await(gate);
        if (refusal !== undefined)
          return yield* new WalkthroughError({ message: refusal });
        const [draft, revised] = answers(request);
        return {
          draft,
          revise: (unclaimed) =>
            Effect.sync(() => {
              revisions.push(unclaimed);
              return revised ?? draft;
            }),
        };
      }),
  }),
);

const hunkIn = (request: ForeignWriteRequest | undefined, path: string) =>
  request?.hunks.find((hunk) => hunk.path === path)?.id ?? "";

const section = (
  title: string,
  hunks: ReadonlyArray<string>,
  decisions: ReadonlyArray<string> = [],
) => ({
  title,
  explanation: `${title}.`,
  hunks,
  decisions,
  risk: { level: "low" as const, reason: "Small." },
});

const makeClient = HttpApiTest.groups(FernApi, [
  "pullRequests",
  "walkthroughs",
]);
const makeLive = RpcTest.makeClient(LiveRpcs);

const fernOn = (database: string) =>
  Layer.mergeAll(
    handlersWith(Writer, FakeIssues, FakeCodeHost).pipe(
      Layer.provideMerge(DatabaseLive(database)),
      Layer.provide(Layer.succeed(WorktreesDir, { dir: dataDir })),
    ),
    HttpServer.layerServices,
  );
// Runs the effect against its own Fern on the database, shut down after: one run of Fern.
const runOn =
  (database: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const context = yield* Layer.build(fernOn(database));
      return yield* effect.pipe(Effect.provideContext(context));
    }).pipe(Effect.scoped);

// The PR's Walkthroughs once there are `count` and none is being written.
const written = (number: number, count = 1) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    const [walkthroughs] = yield* live
      .PullRequestWalkthroughs({ repo: "acme/app", number })
      .pipe(
        Stream.filter(
          (all) =>
            all.length === count && all.every((w) => w.status !== "writing"),
        ),
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("5 seconds"),
      );
    return walkthroughs ?? [];
  });

const only = (walkthroughs: ReadonlyArray<Walkthrough>) => {
  assert.lengthOf(walkthroughs, 1);
  const [walkthrough] = walkthroughs;
  assert.isDefined(walkthrough);
  return walkthrough;
};

// The PR as the Pull requests page lists it.
const listedAs = (root: string, number: number) =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    const list = yield* client.pullRequests.list({
      query: { root, state: "open" },
    });
    return [...list.lone, ...list.stacks.flatMap((s) => s.prs)].find(
      (pr) => pr.number === number,
    );
  });

// A Decision settled in the Project, as answering a Grill Round records it.
const decided = (root: string, question: string, choice: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const round = crypto.randomUUID();
    yield* sql`INSERT INTO rounds ${sql.insert({
      id: round,
      sessionId: "grill",
      questions: JSON.stringify([
        {
          id: "q1",
          title: question,
          body: "",
          options: [choice, "Other"],
          recommended: choice,
          reasoning: "",
        },
      ]),
      postedAt: 1,
    })}`;
    yield* sql`INSERT INTO decisions ${sql.insert({
      id: crypto.randomUUID(),
      project: root,
      sessionId: "grill",
      roundId: round,
      questionId: "q1",
      question,
      choice,
      freeText: null,
      recommended: 1,
      decidedAt: 2,
    })}`;
  }).pipe(Effect.orDie);

const fern = fernOn(join(dataDir, "fern.db"));

layer(fern, { excludeTestServices: true })("Foreign PR Walkthroughs", (it) => {
  it.effect(
    "Walk through explains a fork's PR from where it leaves its base to its head, read in a worktree of its own, leaving the developer's checkout alone",
    () =>
      Effect.gen(function* () {
        const root = project();
        const initial = git(root, "rev-parse", "HEAD");
        // `main` moved on after the PR left it.
        const main = commitOn(root, initial, {
          "b.ts": "export const b = 1;\n",
        });
        const head = commitOn(root, initial, {
          "a.ts": "export const a = 2;\n",
          "stray.ts": "export const stray = true;\n",
        });
        opened(
          7,
          { head, base: main },
          {
            title: "Bump a",
            body: "Bumps a to 2.",
            issue: { number: 3, title: "a is too small", body: "Make it 2." },
          },
        );
        yield* decided(root, "How big should a be?", "Two");
        const status = git(root, "status", "--porcelain");
        answers = (request) => [
          {
            sections: [section("Bump a", [hunkIn(request, "a.ts")], ["d1"])],
            notFromSession: [],
          },
        ];

        const client = yield* makeClient;
        yield* client.pullRequests.walkThrough({
          params: { number: 7 },
          payload: { root },
        });
        const walkthrough = only(yield* written(7));

        const request = explored.at(-1);
        assert.isDefined(request);
        // Only the PR's own change: not what `main` did since.
        assert.deepStrictEqual(
          request.hunks.map((h) => h.path),
          ["a.ts", "stray.ts"],
        );
        assert.deepStrictEqual(request.pr, {
          repo: "acme/app",
          number: 7,
          title: "Bump a",
          body: "Bumps a to 2.",
          issue: { number: 3, title: "a is too small", body: "Make it 2." },
        });
        assert.deepStrictEqual(
          request.decisions.map((d) => [d.id, d.question, d.answer]),
          [["d1", "How big should a be?", "Two"]],
        );
        // Read in the PR's own worktree, at its head, under Fern's worktrees.
        assert.strictEqual(
          request.cwd,
          join(dataDir, "prs", "acme", "app", "7"),
        );
        assert.strictEqual(git(request.cwd, "rev-parse", "HEAD"), head);
        assert.strictEqual(
          readFileSync(join(request.cwd, "a.ts"), "utf8"),
          "export const a = 2;\n",
        );
        // One retry, for exactly what it left out, which stays unexplained.
        assert.deepStrictEqual(revisions.at(-1), [hunkIn(request, "stray.ts")]);

        assert.strictEqual(walkthrough.status, "ready");
        assert.isUndefined(walkthrough.sessionId);
        assert.deepStrictEqual(
          [walkthrough.foreignPr?.repo, walkthrough.foreignPr?.number],
          ["acme/app", 7],
        );
        assert.strictEqual(walkthrough.number, 1);
        assert.strictEqual(walkthrough.since, "pr");
        assert.deepStrictEqual(
          walkthrough.sections.map((s) => [
            s.title,
            s.decisions.map((d) => d.question),
            s.unplanned,
            s.hunks.map((h) => h.path),
          ]),
          [["Bump a", ["How big should a be?"], false, ["a.ts"]]],
        );
        assert.deepStrictEqual(
          walkthrough.unexplained.map((u) => u.hunk.path),
          ["stray.ts"],
        );

        // The developer's checkout is as it was: same branch, commit and uncommitted work.
        assert.strictEqual(git(root, "branch", "--show-current"), "main");
        assert.strictEqual(git(root, "rev-parse", "HEAD"), initial);
        assert.strictEqual(git(root, "status", "--porcelain"), status);
        assert.strictEqual(
          readFileSync(join(root, "a.ts"), "utf8"),
          "export const a = 'mine';\n",
        );
        assert.deepStrictEqual(fetched.at(-1), { cwd: root, number: 7 });

        const listed = yield* listedAs(root, 7);
        assert.deepStrictEqual(
          [listed?.walkthrough?.state, listed?.walkthrough?.head],
          ["unreviewed", head],
        );
      }),
  );

  it.effect(
    "a Section citing no Decision is never Unplanned on a Foreign PR",
    () =>
      Effect.gen(function* () {
        const root = project();
        const initial = git(root, "rev-parse", "HEAD");
        const head = commitOn(root, initial, {
          "a.ts": "export const a = 3;\n",
        });
        opened(8, { head, base: initial });
        answers = (request) => [
          {
            sections: [section("Bump a", [hunkIn(request, "a.ts")])],
            notFromSession: [],
          },
        ];
        const client = yield* makeClient;
        yield* client.pullRequests.walkThrough({
          params: { number: 8 },
          payload: { root },
        });
        const [s] = only(yield* written(8)).sections;
        assert.deepStrictEqual([s?.decisions, s?.unplanned], [[], false]);
      }),
  );

  it.effect(
    "verdicts make the Walkthrough Reviewed and stay in Fern: nothing goes back to any Session",
    () =>
      Effect.gen(function* () {
        const root = project();
        const initial = git(root, "rev-parse", "HEAD");
        const head = commitOn(root, initial, {
          "a.ts": "export const a = 4;\n",
          "c.ts": "export const c = 1;\n",
        });
        opened(9, { head, base: initial });
        answers = (request) => [
          {
            sections: [section("Bump a", [hunkIn(request, "a.ts")])],
            notFromSession: [],
          },
        ];
        const client = yield* makeClient;
        yield* client.pullRequests.walkThrough({
          params: { number: 9 },
          payload: { root },
        });
        const { id, unexplained } = only(yield* written(9));
        yield* client.walkthroughs.verdict({
          params: { id, item: "s1" },
          payload: { kind: "rejected", note: "a should stay small." },
        });
        yield* client.walkthroughs.verdict({
          params: { id, item: unexplained[0]?.hunk.id ?? "" },
          payload: { kind: "approved" },
        });

        const reviewed = only(yield* written(9));
        assert.isDefined(reviewed.reviewedAt);
        assert.isUndefined(reviewed.redirectSentAt);
        assert.isUndefined(reviewed.redirectError);
        assert.deepStrictEqual(
          [
            reviewed.sections[0]?.verdict?.kind,
            reviewed.sections[0]?.verdict?.note,
          ],
          ["rejected", "a should stay small."],
        );
        const refused = yield* client.walkthroughs
          .redirect({ params: { id } })
          .pipe(Effect.flip);
        assert.strictEqual(refused._tag, "ReviewClosed");
        assert.strictEqual(
          (yield* listedAs(root, 9))?.walkthrough?.state,
          "reviewed",
        );
      }),
  );

  it.effect(
    "a second Walk through while one is being written is refused, and the PR shows it being written",
    () =>
      Effect.gen(function* () {
        const root = project();
        const initial = git(root, "rev-parse", "HEAD");
        const head = commitOn(root, initial, {
          "a.ts": "export const a = 5;\n",
        });
        opened(10, { head, base: initial });
        gate = yield* Deferred.make<void>();
        const client = yield* makeClient;
        yield* client.pullRequests.walkThrough({
          params: { number: 10 },
          payload: { root },
        });
        assert.strictEqual(
          (yield* listedAs(root, 10))?.walkthrough?.state,
          "writing",
        );
        const again = yield* client.pullRequests
          .walkThrough({ params: { number: 10 }, payload: { root } })
          .pipe(Effect.flip);
        assert.strictEqual(again._tag, "PrWalkthroughInProgress");

        yield* Deferred.succeed(gate, undefined);
        gate = undefined;
        only(yield* written(10));
      }),
  );

  it.effect(
    "a Walkthrough that couldn't be written says why, and walking through again replaces it",
    () =>
      Effect.gen(function* () {
        const root = project();
        const initial = git(root, "rev-parse", "HEAD");
        const head = commitOn(root, initial, {
          "a.ts": "export const a = 6;\n",
        });
        opened(11, { head, base: initial });
        refusal = "The writer took too long.";
        const client = yield* makeClient;
        yield* client.pullRequests.walkThrough({
          params: { number: 11 },
          payload: { root },
        });
        const failed = only(yield* written(11));
        refusal = undefined;
        assert.deepStrictEqual(
          [failed.status, failed.error],
          ["failed", "The writer took too long."],
        );
        const shown = (yield* listedAs(root, 11))?.walkthrough;
        assert.deepStrictEqual(
          [shown?.state, shown?.head, shown?.error],
          ["failed", head, "The writer took too long."],
        );

        answers = (request) => [
          {
            sections: [section("Bump a", [hunkIn(request, "a.ts")])],
            notFromSession: [],
          },
        ];
        yield* client.pullRequests.walkThrough({
          params: { number: 11 },
          payload: { root },
        });
        const again = only(yield* written(11));
        assert.deepStrictEqual([again.status, again.number], ["ready", 1]);
      }),
  );

  it.effect(
    "checking a PR out runs none of the developer's git filters, whatever its .gitattributes ask for",
    () =>
      Effect.gen(function* () {
        const root = project();
        const initial = git(root, "rev-parse", "HEAD");
        const head = commitOn(root, initial, {
          ".gitattributes": "*.ts filter=evil\n",
          "a.ts": "export const a = 9;\n",
        });
        opened(14, { head, base: initial });
        // A filter of the developer's own, as git-lfs installs one.
        const marker = join(root, "..", `smudged-${crypto.randomUUID()}`);
        git(root, "config", "filter.evil.smudge", `touch ${marker} && cat`);
        git(root, "config", "filter.evil.process", `touch ${marker}`);
        git(root, "config", "filter.evil.required", "true");
        answers = (request) => [
          {
            sections: [
              section("Bump a", [
                hunkIn(request, "a.ts"),
                hunkIn(request, ".gitattributes"),
              ]),
            ],
            notFromSession: [],
          },
        ];
        const client = yield* makeClient;
        yield* client.pullRequests.walkThrough({
          params: { number: 14 },
          payload: { root },
        });
        assert.strictEqual(only(yield* written(14)).status, "ready");
        assert.isFalse(existsSync(marker));
        assert.strictEqual(
          readFileSync(
            join(dataDir, "prs", "acme", "app", "14", "a.ts"),
            "utf8",
          ),
          "export const a = 9;\n",
        );
      }),
  );

  it.effect("a PR that changes nothing has nothing to walk through", () =>
    Effect.gen(function* () {
      const root = project();
      const initial = git(root, "rev-parse", "HEAD");
      opened(12, { head: initial, base: initial });
      const client = yield* makeClient;
      const failed = yield* client.pullRequests
        .walkThrough({ params: { number: 12 }, payload: { root } })
        .pipe(Effect.flip);
      assert.strictEqual(failed._tag, "PrNothingToReview");
    }),
  );

  it.effect(
    "a PR on a Hosted Session's Stack is never walked through as a Foreign PR",
    () =>
      Effect.gen(function* () {
        const root = project();
        const initial = git(root, "rev-parse", "HEAD");
        const head = commitOn(root, initial, {
          "a.ts": "export const a = 7;\n",
        });
        opened(13, { head, base: initial });
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO stack_prs ${sql.insert({
          id: crypto.randomUUID(),
          sessionId: "hosted",
          position: 1,
          ticket: 3,
          title: "PR 13",
          mergeCommit: head,
          branch: "branch-13",
          base: "main",
          number: 13,
          url: "https://github.com/acme/app/pull/13",
          createdAt: 1,
          kind: "ticket",
        })}`.pipe(Effect.orDie);

        const client = yield* makeClient;
        const failed = yield* client.pullRequests
          .walkThrough({ params: { number: 13 }, payload: { root } })
          .pipe(Effect.flip);
        assert.deepStrictEqual(
          {
            tag: failed._tag,
            session: "session" in failed ? failed.session : undefined,
          },
          { tag: "PullRequestNotForeign", session: "hosted" },
        );
        assert.isFalse(existsSync(join(dataDir, "prs", "acme", "app", "13")));
      }),
  );
});

layer(HttpServer.layerServices)(
  "Foreign PR Walkthroughs across restarts",
  (it) => {
    it.effect(
      "verdicts survive a restart, and one Fern was writing when it stopped fails rather than staying written forever",
      () =>
        Effect.gen(function* () {
          const database = join(
            mkdtempSync(join(tmpdir(), "fern-restart-")),
            "fern.db",
          );
          const root = project();
          const initial = git(root, "rev-parse", "HEAD");
          const head = commitOn(root, initial, {
            "a.ts": "export const a = 8;\n",
          });
          opened(20, { head, base: initial });
          opened(21, { head, base: initial });
          answers = (request) => [
            {
              sections: [section("Bump a", [hunkIn(request, "a.ts")])],
              notFromSession: [],
            },
          ];

          yield* runOn(database)(
            Effect.gen(function* () {
              const client = yield* makeClient;
              yield* client.pullRequests.walkThrough({
                params: { number: 20 },
                payload: { root },
              });
              const { id } = only(yield* written(20));
              yield* client.walkthroughs.verdict({
                params: { id, item: "s1" },
                payload: { kind: "approved" },
              });
              // Fern stops while this one is being written.
              gate = yield* Deferred.make<void>();
              yield* client.pullRequests.walkThrough({
                params: { number: 21 },
                payload: { root },
              });
            }),
          );
          gate = undefined;

          yield* runOn(database)(
            Effect.gen(function* () {
              const kept = only(yield* written(20));
              assert.isDefined(kept.reviewedAt);
              assert.strictEqual(kept.sections[0]?.verdict?.kind, "approved");
              const stopped = only(yield* written(21));
              assert.strictEqual(stopped.status, "failed");
              assert.include(stopped.error ?? "", "Fern stopped");
            }),
          );
        }),
    );
  },
);
