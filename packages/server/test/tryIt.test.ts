import { assert, layer } from "@effect/vitest";
import {
  FernApi,
  LiveRpcs,
  type ListedPullRequest,
  type PrListState,
  type TerminalTarget,
} from "@repo/api";
import { Deferred, Effect, Layer, Schedule, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { RpcTest } from "effect/rpc";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
import { TerminalShell } from "../src/terminal/Terminals";
import { WalkthroughWriter } from "../src/walkthrough/WalkthroughWriter";
import { WorktreesDir } from "../src/worktree/Worktrees";
import { FakeIssues } from "./stubs";

// Try it on the Pull requests page: a Foreign PR checked out in a worktree of its own, with a
// Terminal there, against a real git repo, a real shell, and GitHub faked.

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd, encoding: "utf8" },
  ).trim();

const configDir = mkdtempSync(join(tmpdir(), "fern-claude-"));
process.env.CLAUDE_CONFIG_DIR = configDir;
const dataDir = realpathSync(mkdtempSync(join(tmpdir(), "fern-data-")));

// A Project on GitHub: the developer's checkout of acme/app, on `main`, with work of their own not
// committed yet.
const project = () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "fern-repo-")));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Initial");
  git(repo, "remote", "add", "origin", "git@github.com:acme/app.git");
  known(repo);
  writeFileSync(join(repo, "a.ts"), "export const a = 'mine';\n");
  return repo;
};

// A second clone of acme/app, with the branches of the one at `from`, also a Project.
const cloneOf = (from: string) => {
  const repo = join(realpathSync(mkdtempSync(join(tmpdir(), "fern-"))), "app");
  git(from, "clone", "-q", from, repo);
  git(repo, "remote", "set-url", "origin", "git@github.com:acme/app.git");
  known(repo);
  return repo;
};

// A Session ran in the folder, so Fern knows it as a Project.
const known = (repo: string) => {
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

// What GitHub has of the repo: each PR, and the commits its head and base branch are at. PR numbers
// are unique across the tests, as every test's Project is acme/app.
interface OnGitHub {
  readonly pr: HostPullRequestDetail;
  readonly head: string;
  readonly base: string;
}
const github = new Map<number, OnGitHub>();
const asked: Array<number> = [];
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
      issue: undefined,
      ...init,
    },
    ...at,
  });
};
// The PR on GitHub, changed: pushed to, closed or merged.
const changed = (
  number: number,
  update: Partial<HostPullRequestDetail> & { readonly head?: string },
) => {
  const found = github.get(number);
  if (!found) throw new Error(`No PR #${number}`);
  const head = update.head ?? found.head;
  github.set(number, {
    ...found,
    head,
    pr: { ...found.pr, ...update, headCommit: head },
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
    // As `gh pr list --state` would: the open ones, or the closed ones with the merged ones.
    pullRequests: (_cwd, state) =>
      Effect.sync(() =>
        [...github.values()]
          .map(({ pr }) => pr)
          .filter((pr) => (pr.state === "open") === (state === "open")),
      ),
    stacks: () => Effect.succeed([]),
    pullRequest: (_cwd, number) =>
      Effect.suspend(() => {
        asked.push(number);
        const found = github.get(number);
        return found
          ? Effect.succeed(found.pr)
          : Effect.fail(
              new CodeHostError({
                message: `Could not resolve to a PullRequest with the number of ${number}.`,
              }),
            );
      }),
    fetchPullRequest: (cwd, { number }) =>
      Effect.sync(() => {
        const found = github.get(number);
        if (!found) throw new Error(`No PR #${number}`);
        git(cwd, "update-ref", prHeadRef(number), found.head);
        git(cwd, "update-ref", prBaseRef(number), found.base);
      }),
    commitsAhead: () => Effect.die("unused"),
    postReview: () => Effect.die("unused"),
  }),
);

// The writer of Foreign PR Walkthroughs, held at `gate` while a test keeps one being written.
let gate: Deferred.Deferred<void> | undefined;
const Writer = Layer.succeed(
  WalkthroughWriter,
  WalkthroughWriter.of({
    write: () => Effect.die("unused"),
    explore: (request) =>
      Effect.gen(function* () {
        if (gate) yield* Deferred.await(gate);
        const draft = {
          sections: request.hunks.map((hunk) => ({
            title: hunk.path,
            explanation: `${hunk.path}.`,
            hunks: [hunk.id],
            decisions: [],
            risk: { level: "low" as const, reason: "Small." },
          })),
          notFromSession: [],
        };
        return { draft, revise: () => Effect.succeed(draft) };
      }),
  }),
);

const makeClient = HttpApiTest.groups(FernApi, ["pullRequests"]);
const makeLive = RpcTest.makeClient(LiveRpcs);

const fern = Layer.mergeAll(
  handlersWith(Writer, FakeIssues, FakeCodeHost).pipe(
    Layer.provide([
      DatabaseLive(":memory:"),
      Layer.succeed(WorktreesDir, { dir: dataDir }),
      Layer.succeed(TerminalShell, { file: "/bin/sh", args: [] }),
    ]),
  ),
  HttpServer.layerServices,
);

// Where the Project's worktree of the PR is, as its repo has it: under Fern's worktrees folder,
// apart from the developer's checkout. None once it has none.
const worktreeOf = (root: string, number: number) =>
  git(root, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .find(
      (path) =>
        path.startsWith(`${join(dataDir, "prs")}/`) &&
        path.endsWith(`/acme/app/${number}`),
    );
// The same, for one the test knows is there.
const worktreeAt = (root: string, number: number) => {
  const found = worktreeOf(root, number);
  assert.isDefined(found);
  return found;
};

const prTerminal = (root: string, number: number): TerminalTarget => ({
  _tag: "PullRequest",
  root,
  repo: "acme/app",
  number,
});

// A viewer of the terminal: what it has printed so far, and a way to wait for some of it.
const watch = Effect.fn(function* (target: TerminalTarget) {
  const live = yield* makeLive;
  const printed: Array<string> = [];
  let exit: number | undefined;
  yield* live.Terminal({ target, cols: 80, rows: 24 }).pipe(
    Stream.runForEach((event) =>
      Effect.sync(() => {
        if (event._tag === "TerminalExit") exit = event.code;
        else printed.push(event.data);
      }),
    ),
    Effect.forkScoped,
  );
  // Whether the viewer is told the shell exited, within a few seconds.
  const exited = Effect.suspend(() =>
    exit === undefined ? Effect.fail("running") : Effect.succeed(true),
  ).pipe(
    Effect.retry({ schedule: Schedule.spaced("20 millis"), times: 150 }),
    Effect.orElseSucceed(() => false),
  );
  // Types the command until the output holds `text`: the shell may not be listening yet.
  const until = (command: string, text: string) =>
    Effect.suspend(() =>
      live
        .TerminalInput({ target, data: `${command}\r` })
        .pipe(
          Effect.andThen(
            printed.join("").includes(text)
              ? Effect.void
              : Effect.fail(`never printed ${text}`),
          ),
        ),
    ).pipe(
      Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 50 }),
    );
  return { printed, until, exited };
});

// The PR as the Pull requests page lists it, in the open list or the closed one.
const listedAs = (root: string, number: number, state: PrListState = "open") =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    const list = yield* client.pullRequests.list({ query: { root, state } });
    return [...list.lone, ...list.stacks.flatMap((s) => s.prs)].find(
      (pr: ListedPullRequest) => pr.number === number,
    );
  });

// A commit on top of `from` adding git hooks in `folder`, as a PR could: each, when it runs, leaves
// a file named after itself in `marks`.
const commitHooks = (
  repo: string,
  from: string,
  folder: string,
  marks: string,
) => {
  const elsewhere = join(mkdtempSync(join(tmpdir(), "fern-fork-")), "work");
  git(repo, "worktree", "add", "-q", "--detach", elsewhere, from);
  mkdirSync(join(elsewhere, folder), { recursive: true });
  for (const hook of ["post-checkout", "reference-transaction"]) {
    const file = join(elsewhere, folder, hook);
    writeFileSync(file, `#!/bin/sh\ntouch "${marks}/${hook}"\n`);
    chmodSync(file, 0o755);
  }
  git(elsewhere, "add", "-A", "-f");
  git(elsewhere, "commit", "-q", "-m", "Hooks");
  const commit = git(elsewhere, "rev-parse", "HEAD");
  git(repo, "worktree", "remove", "--force", elsewhere);
  return commit;
};

layer(fern, { excludeTestServices: true })("Try it", (it) => {
  it.effect(
    "runs none of the git hooks a PR brings, though the developer's hooks path is relative",
    () =>
      Effect.gen(function* () {
        const root = project();
        const initial = git(root, "rev-parse", "HEAD");
        const marks = realpathSync(mkdtempSync(join(tmpdir(), "fern-hooks-")));
        const first = commitHooks(root, initial, ".husky/_", marks);
        const second = commitOn(root, first, {
          "a.ts": "export const a = 3;\n",
        });
        // As husky sets it: relative, so git reads it in whichever worktree it runs in.
        git(root, "config", "core.hooksPath", ".husky/_");
        opened(113, { head: first, base: initial });
        const client = yield* makeClient;

        // Made, then moved to the PR's new head, then read for a Walkthrough, then removed.
        yield* client.pullRequests.tryIt({
          params: { number: 113 },
          payload: { root },
        });
        changed(113, { head: second });
        yield* client.pullRequests.tryIt({
          params: { number: 113 },
          payload: { root },
        });
        yield* client.pullRequests.walkThrough({
          params: { number: 113 },
          payload: { root },
        });
        yield* client.pullRequests
          .dismiss({ params: { number: 113 }, payload: { root } })
          .pipe(
            Effect.retry({
              schedule: Schedule.spaced("50 millis"),
              times: 100,
            }),
          );

        assert.isUndefined(worktreeOf(root, 113));
        assert.deepStrictEqual(readdirSync(marks), []);
      }),
  );

  it.effect(
    "two clones of the same repo, each a Project, each have a worktree and a Terminal of their own for the same PR",
    () =>
      Effect.gen(function* () {
        const root = project();
        const initial = git(root, "rev-parse", "HEAD");
        const head = commitOn(root, initial, {
          "a.ts": "export const a = 2;\n",
        });
        git(root, "branch", "pr-114", head);
        const other = cloneOf(root);
        opened(114, { head, base: initial });
        const client = yield* makeClient;
        for (const at of [root, other])
          yield* client.pullRequests.tryIt({
            params: { number: 114 },
            payload: { root: at },
          });

        const [mine, theirs] = [worktreeAt(root, 114), worktreeAt(other, 114)];
        assert.notStrictEqual(mine, theirs);
        const [inMine, inTheirs] = [
          yield* watch(prTerminal(root, 114)),
          yield* watch(prTerminal(other, 114)),
        ];
        yield* inMine.until("echo $PWD", `${mine}\r`);
        yield* inTheirs.until("echo $PWD", `${theirs}\r`);

        yield* client.pullRequests.dismiss({
          params: { number: 114 },
          payload: { root: other },
        });
        assert.isFalse(existsSync(theirs));
        assert.isTrue(yield* inTheirs.exited);
        assert.strictEqual(git(mine, "rev-parse", "HEAD"), head);
        assert.strictEqual((yield* listedAs(root, 114))?.worktree?.head, head);
        assert.isUndefined((yield* listedAs(other, 114))?.worktree);
      }),
  );

  it.effect(
    "checks the PR's head out in a detached worktree of its own, with a Terminal there, leaving the developer's checkout alone",
    () =>
      Effect.gen(function* () {
        const root = project();
        const initial = git(root, "rev-parse", "HEAD");
        const head = commitOn(root, initial, {
          "a.ts": "export const a = 2;\n",
        });
        opened(101, { head, base: initial });
        const status = git(root, "status", "--porcelain");

        const client = yield* makeClient;
        const tried = yield* client.pullRequests.tryIt({
          params: { number: 101 },
          payload: { root },
        });

        assert.strictEqual(tried.head, head);
        const worktree = worktreeAt(root, 101);
        assert.strictEqual(git(worktree, "rev-parse", "HEAD"), head);
        assert.strictEqual(git(worktree, "branch", "--show-current"), "");
        assert.strictEqual(
          readFileSync(join(worktree, "a.ts"), "utf8"),
          "export const a = 2;\n",
        );
        assert.strictEqual(git(root, "branch", "--show-current"), "main");
        assert.strictEqual(git(root, "rev-parse", "HEAD"), initial);
        assert.strictEqual(git(root, "status", "--porcelain"), status);

        const terminal = yield* watch(prTerminal(root, 101));
        yield* terminal.until("echo $PWD", `${worktree}\r`);

        assert.strictEqual((yield* listedAs(root, 101))?.worktree?.head, head);
      }),
  );

  it.effect(
    "pressed again, it reuses the worktree and its running shell, moved to the PR's new head once the PR moved",
    () =>
      Effect.gen(function* () {
        const root = project();
        const initial = git(root, "rev-parse", "HEAD");
        const first = commitOn(root, initial, {
          "a.ts": "export const a = 2;\n",
        });
        opened(102, { head: first, base: initial });
        const client = yield* makeClient;
        const tryIt = client.pullRequests.tryIt({
          params: { number: 102 },
          payload: { root },
        });
        yield* tryIt;
        const terminal = yield* watch(prTerminal(root, 102));
        yield* terminal.until("echo pid=$$", "pid=");
        const pid = /pid=(\d+)/.exec(terminal.printed.join(""))?.[1];

        assert.strictEqual((yield* tryIt).head, first);

        const second = commitOn(root, first, {
          "a.ts": "export const a = 3;\n",
        });
        changed(102, { head: second });
        assert.strictEqual((yield* tryIt).head, second);

        const worktree = worktreeAt(root, 102);
        assert.strictEqual(git(worktree, "rev-parse", "HEAD"), second);
        assert.strictEqual(
          readFileSync(join(worktree, "a.ts"), "utf8"),
          "export const a = 3;\n",
        );
        yield* terminal.until("echo still=$$", `still=${pid}`);
        assert.strictEqual(
          (yield* listedAs(root, 102))?.worktree?.head,
          second,
        );
      }),
  );

  it.effect(
    "dismissing removes the worktree and ends the shell in its Terminal",
    () =>
      Effect.gen(function* () {
        const root = project();
        const initial = git(root, "rev-parse", "HEAD");
        const head = commitOn(root, initial, {
          "a.ts": "export const a = 2;\n",
        });
        opened(104, { head, base: initial });
        const client = yield* makeClient;
        yield* client.pullRequests.tryIt({
          params: { number: 104 },
          payload: { root },
        });
        const terminal = yield* watch(prTerminal(root, 104));
        yield* terminal.until("echo up", "up\r");
        const worktree = worktreeAt(root, 104);

        yield* client.pullRequests.dismiss({
          params: { number: 104 },
          payload: { root },
        });

        assert.isFalse(existsSync(worktree));
        assert.isUndefined(worktreeOf(root, 104));
        assert.isTrue(yield* terminal.exited);
        assert.isUndefined((yield* listedAs(root, 104))?.worktree);
        const live = yield* makeLive;
        const reopened = yield* live
          .Terminal({ target: prTerminal(root, 104), cols: 80, rows: 24 })
          .pipe(Stream.runDrain, Effect.flip);
        assert.strictEqual(reopened._tag, "TerminalError");
        // Nothing left to dismiss.
        yield* client.pullRequests.dismiss({
          params: { number: 104 },
          payload: { root },
        });
      }),
  );

  it.effect(
    "a worktree with changes not committed is only dismissed once the developer says to discard them",
    () =>
      Effect.gen(function* () {
        const root = project();
        const initial = git(root, "rev-parse", "HEAD");
        const head = commitOn(root, initial, {
          "a.ts": "export const a = 2;\n",
        });
        opened(105, { head, base: initial });
        const client = yield* makeClient;
        yield* client.pullRequests.tryIt({
          params: { number: 105 },
          payload: { root },
        });
        const worktree = worktreeAt(root, 105);
        writeFileSync(join(worktree, "new.ts"), "export const tried = 1;\n");

        const refused = yield* client.pullRequests
          .dismiss({ params: { number: 105 }, payload: { root } })
          .pipe(Effect.flip);
        assert.strictEqual(refused._tag, "PrUncommittedChanges");
        assert.isTrue(existsSync(join(worktree, "new.ts")));

        yield* client.pullRequests.dismiss({
          params: { number: 105 },
          payload: { root, discard: true },
        });
        assert.isFalse(existsSync(worktree));
      }),
  );

  it.effect(
    "isn't offered on a closed or merged PR, which has no Terminal",
    () =>
      Effect.gen(function* () {
        const root = project();
        const initial = git(root, "rev-parse", "HEAD");
        const head = commitOn(root, initial, {
          "a.ts": "export const a = 2;\n",
        });
        opened(106, { head, base: initial }, { state: "closed" });
        opened(107, { head, base: initial }, { state: "merged" });
        const client = yield* makeClient;
        for (const number of [106, 107]) {
          const refused = yield* client.pullRequests
            .tryIt({ params: { number }, payload: { root } })
            .pipe(Effect.flip);
          assert.strictEqual(refused._tag, "PrNotOpen");
          assert.isUndefined(worktreeOf(root, number));
          const live = yield* makeLive;
          const noTerminal = yield* live
            .Terminal({ target: prTerminal(root, number), cols: 80, rows: 24 })
            .pipe(Stream.runDrain, Effect.flip);
          assert.strictEqual(noTerminal._tag, "TerminalError");
        }
      }),
  );

  it.effect(
    "a refresh of the list removes the worktree of a PR that has closed or merged since, once its Terminal's shell has ended",
    () =>
      Effect.gen(function* () {
        const root = project();
        const initial = git(root, "rev-parse", "HEAD");
        const head = commitOn(root, initial, {
          "a.ts": "export const a = 2;\n",
        });
        opened(108, { head, base: initial });
        opened(109, { head, base: initial });
        opened(110, { head, base: initial });
        const client = yield* makeClient;
        for (const number of [108, 109, 110])
          yield* client.pullRequests.tryIt({
            params: { number },
            payload: { root },
          });
        const terminal = yield* watch(prTerminal(root, 108));
        yield* terminal.until("echo up", "up\r");
        const [merged, closed] = [worktreeAt(root, 108), worktreeAt(root, 109)];

        // Merged: gone from the open list, so GitHub is asked about it. Its shell is still
        // running, so the worktree stays, and the shell with it.
        changed(108, { state: "merged" });
        assert.strictEqual(
          (yield* listedAs(root, 108, "closed"))?.worktree?.head,
          head,
        );
        yield* listedAs(root, 110);
        assert.isTrue(existsSync(merged));
        yield* terminal.until("echo still", "still\r");
        assert.isTrue(existsSync(closed));

        // Once the shell has ended, the next refresh removes it.
        const live = yield* makeLive;
        yield* live.TerminalInput({
          target: prTerminal(root, 108),
          data: "exit\r",
        });
        assert.isTrue(yield* terminal.exited);
        yield* listedAs(root, 110);
        assert.isFalse(existsSync(merged));
        assert.isUndefined(worktreeOf(root, 108));

        // Closed: seen so in the closed list. Its Terminal was never opened.
        changed(109, { state: "closed" });
        assert.isUndefined((yield* listedAs(root, 109, "closed"))?.worktree);
        assert.isFalse(existsSync(closed));

        // Still open.
        assert.strictEqual((yield* listedAs(root, 110))?.worktree?.head, head);
      }),
  );

  it.effect(
    "a refresh keeps the worktree of a closed PR that has changes not committed, for the developer to dismiss",
    () =>
      Effect.gen(function* () {
        const root = project();
        const initial = git(root, "rev-parse", "HEAD");
        const head = commitOn(root, initial, {
          "a.ts": "export const a = 2;\n",
        });
        opened(111, { head, base: initial });
        const client = yield* makeClient;
        yield* client.pullRequests.tryIt({
          params: { number: 111 },
          payload: { root },
        });
        const worktree = worktreeAt(root, 111);
        writeFileSync(join(worktree, "a.ts"), "export const a = 9;\n");
        changed(111, { state: "closed" });

        asked.length = 0;
        yield* listedAs(root, 111);
        // Known to need the developer, so not asked of GitHub again on every refresh.
        assert.notInclude(asked, 111);
        assert.strictEqual(
          (yield* listedAs(root, 111, "closed"))?.worktree?.head,
          head,
        );
        assert.isTrue(existsSync(worktree));

        yield* client.pullRequests.dismiss({
          params: { number: 111 },
          payload: { root, discard: true },
        });
        assert.isFalse(existsSync(worktree));
      }),
  );

  it.effect(
    "never moves or removes the worktree while a Walkthrough is being written in it",
    () =>
      Effect.gen(function* () {
        const root = project();
        const initial = git(root, "rev-parse", "HEAD");
        const first = commitOn(root, initial, {
          "a.ts": "export const a = 2;\n",
        });
        opened(112, { head: first, base: initial });
        const client = yield* makeClient;
        const held = yield* Deferred.make<void>();
        gate = held;
        yield* client.pullRequests.walkThrough({
          params: { number: 112 },
          payload: { root },
        });

        // At the head being explained: tried as it is.
        const tried = yield* client.pullRequests.tryIt({
          params: { number: 112 },
          payload: { root },
        });
        assert.strictEqual(tried.head, first);

        changed(112, {
          head: commitOn(root, first, { "a.ts": "export const a = 3;\n" }),
        });
        const moving = yield* client.pullRequests
          .tryIt({ params: { number: 112 }, payload: { root } })
          .pipe(Effect.flip);
        const removing = yield* client.pullRequests
          .dismiss({ params: { number: 112 }, payload: { root } })
          .pipe(Effect.flip);
        changed(112, { state: "closed" });
        yield* listedAs(root, 112, "closed");

        assert.deepStrictEqual(
          [moving._tag, removing._tag],
          ["PrWalkthroughInProgress", "PrWalkthroughInProgress"],
        );
        assert.strictEqual(
          git(worktreeAt(root, 112), "rev-parse", "HEAD"),
          first,
        );
        gate = undefined;
        yield* Deferred.succeed(held, undefined);
      }),
  );

  it.effect(
    "won't move a worktree with changes not committed, which it still reuses where it is",
    () =>
      Effect.gen(function* () {
        const root = project();
        const initial = git(root, "rev-parse", "HEAD");
        const first = commitOn(root, initial, {
          "a.ts": "export const a = 2;\n",
        });
        opened(103, { head: first, base: initial });
        const client = yield* makeClient;
        const tryIt = client.pullRequests.tryIt({
          params: { number: 103 },
          payload: { root },
        });
        yield* tryIt;
        const worktree = worktreeAt(root, 103);
        writeFileSync(join(worktree, "a.ts"), "export const a = 'tried';\n");

        assert.strictEqual((yield* tryIt).head, first);

        changed(103, {
          head: commitOn(root, first, { "a.ts": "export const a = 3;\n" }),
        });
        const refused = yield* tryIt.pipe(Effect.flip);
        assert.strictEqual(refused._tag, "PrUncommittedChanges");
        assert.strictEqual(git(worktree, "rev-parse", "HEAD"), first);
        assert.strictEqual(
          readFileSync(join(worktree, "a.ts"), "utf8"),
          "export const a = 'tried';\n",
        );
      }),
  );
});
