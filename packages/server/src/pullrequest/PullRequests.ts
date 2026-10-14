import {
  ListedPullRequest,
  ListedStack,
  type PrNothingToReview,
  PostedReview,
  PrReview,
  PrNotOpen,
  PrStackNotFound,
  PrStackPlace,
  PrStackWalkthrough,
  type PrListState,
  PrUncommittedChanges,
  PrWalkthrough,
  PrWalkthroughInProgress,
  type PrWalkthroughOf,
  PrWalkthroughUpToDate,
  PrWorktree,
  ProjectNotFound,
  PullRequestList,
  PullRequestNotForeign,
  PullRequestsAvailability,
  PullRequestsError,
  PullRequestsUnavailable,
  ReviewPostedAlready,
  WalkthroughError,
  WalkthroughNotFound,
  WalkthroughNotReviewed,
  WorkspaceError,
  type WorktreeError,
} from "@repo/api";
import {
  Cache,
  Context,
  DateTime,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
  Semaphore,
} from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import {
  CodeHost,
  type HostPullRequest,
  type HostPullRequestDetail,
  type HostStack,
  prBaseRef,
  prHeadRef,
} from "../codehost/CodeHost";
import { gitHubRepo } from "../codehost/gitHubRepo";
import { Git } from "../git/Git";
import { prTerminalKey, Terminals } from "../terminal/Terminals";
import { HostedSessions } from "../turn/HostedSessions";
import { Walkthroughs } from "../walkthrough/Walkthroughs";
import { type PrKey, PrWorktrees } from "./PrWorktrees";
import { reviewOf } from "./review";

// How long Fern goes by what git and `gh` last said about a Project's repo: long enough that the
// sidebar asks once for every Project, short enough that signing in or out of `gh` soon shows.
const REMEMBERED = "30 seconds";
// How long Fern goes without a count of a PR's new commits GitHub couldn't give, before asking
// again, and how many it asks for at once.
const NOT_COUNTED = "5 minutes";
const COMPARING = 4;

// Where a Project's PRs are on GitHub: its repo, and who `gh` is signed in as.
interface OnGitHub {
  readonly repo: string;
  readonly login: string;
}

// Why Fern won't show or post a Foreign PR's review.
type ReviewRefusal =
  | ProjectNotFound
  | WorkspaceError
  | PullRequestsUnavailable
  | PullRequestsError
  | WalkthroughNotFound
  | PrNotOpen
  | WalkthroughNotReviewed
  | ReviewPostedAlready;

// The listed PRs that could be in a Stack with another listed PR: those based on another's head,
// or whose head another is based on. Only these send Fern looking past GitHub's newest Stacks.
const chained = (prs: ReadonlyArray<HostPullRequest>) => {
  const heads = new Set(prs.map((pr) => pr.headRef));
  const bases = new Set(prs.map((pr) => pr.baseRef));
  return prs
    .filter((pr) => heads.has(pr.baseRef) || bases.has(pr.headRef))
    .map((pr) => pr.number);
};

// The PRs as the page lists them: in the Stacks that hold them, bottom first, then the rest. A PR
// two Stacks claim goes in the first, the newest.
const grouped = (
  prs: ReadonlyArray<HostPullRequest>,
  stacks: ReadonlyArray<HostStack>,
  login: string,
  sessions: ReadonlyMap<string, string>,
  walkthroughs: ReadonlyMap<number, PrWalkthrough>,
  worktrees: ReadonlyMap<number, PrWorktree>,
) => {
  const byNumber = new Map(prs.map((pr) => [pr.number, pr]));
  const placed = new Set<number>();
  const listed = (pr: HostPullRequest, stack?: PrStackPlace) =>
    new ListedPullRequest({
      number: pr.number,
      url: pr.url,
      title: pr.title,
      author: pr.author,
      headRef: pr.headRef,
      baseRef: pr.baseRef,
      headCommit: pr.headCommit,
      draft: pr.draft,
      state: pr.state,
      reviewRequested: pr.reviewers.includes(login),
      stack,
      session: sessions.get(pr.url),
      // A Hosted Session's PR has its Session's Walkthroughs, never a Foreign PR's.
      walkthrough: sessions.has(pr.url)
        ? undefined
        : walkthroughs.get(pr.number),
      worktree: sessions.has(pr.url) ? undefined : worktrees.get(pr.number),
    });
  const inStacks = stacks.flatMap((stack) => {
    const held = stack.prs.flatMap((number, index) => {
      const pr = byNumber.get(number);
      if (!pr || placed.has(number)) return [];
      placed.add(number);
      return [
        listed(pr, new PrStackPlace({ id: stack.id, position: index + 1 })),
      ];
    });
    return held.length === 0
      ? []
      : [new ListedStack({ id: stack.id, number: stack.number, prs: held })];
  });
  return {
    stacks: inStacks,
    lone: prs.filter((pr) => !placed.has(pr.number)).map((pr) => listed(pr)),
  };
};

// A Project's pull requests on GitHub, for its Pull requests page: asked of GitHub each time, in
// the Project's own folder, and matched to the PRs Fern's Hosted Sessions hold on their Stacks.
export class PullRequests extends Context.Service<
  PullRequests,
  {
    // Whether the Project has a Pull requests page: its `origin` on GitHub and `gh` signed in.
    available(
      root: string,
    ): Effect.Effect<
      PullRequestsAvailability,
      ProjectNotFound | WorkspaceError
    >;
    // The Project's PRs in one `state`, open or closed, grouped into their GitHub Stacks.
    list(
      root: string,
      state: PrListState,
    ): Effect.Effect<
      PullRequestList,
      | ProjectNotFound
      | WorkspaceError
      | PullRequestsUnavailable
      | PullRequestsError
    >;
    // Starts writing a Walkthrough of the Foreign PR: its head and base fetched from GitHub into the
    // Project's repo, its own worktree checked out at the head, and a fresh read-only writer
    // started there on the change from where the PR leaves its base (ADR 0010).
    walkThrough(
      root: string,
      number: number,
    ): Effect.Effect<
      void,
      | ProjectNotFound
      | WorkspaceError
      | PullRequestsUnavailable
      | PullRequestsError
      | PullRequestNotForeign
      | PrWalkthroughInProgress
      | PrWalkthroughUpToDate
      | PrNothingToReview
      | WalkthroughError
    >;
    // Walks through the Stack's Foreign PRs as the list in `state` holds them, bottom first, one
    // at a time, skipping any up to date.
    walkThroughStack(
      root: string,
      id: number,
      state: PrListState,
    ): Effect.Effect<
      PrStackWalkthrough,
      | ProjectNotFound
      | WorkspaceError
      | PullRequestsUnavailable
      | PullRequestsError
      | PrStackNotFound
      | WalkthroughError
    >;
    // The review posting the Foreign PR's Walkthrough would put on the PR, without posting it.
    review(
      root: string,
      number: number,
      walkthroughId: string,
    ): Effect.Effect<PrReview, ReviewRefusal>;
    // Posts that review on GitHub, once: a refusal is kept on the Walkthrough with GitHub's reason.
    postReview(
      root: string,
      number: number,
      walkthroughId: string,
    ): Effect.Effect<PostedReview, ReviewRefusal>;
    // Try it: the open Foreign PR's head, fetched from GitHub, checked out in its own worktree, for
    // its Terminal. The worktree is made if there's none, else moved to the head if the PR moved,
    // never while a Walkthrough is being written in it or while it has changes not committed.
    tryIt(
      root: string,
      number: number,
    ): Effect.Effect<
      PrWorktree,
      | ProjectNotFound
      | WorkspaceError
      | PullRequestsUnavailable
      | PullRequestsError
      | PullRequestNotForeign
      | PrNotOpen
      | PrWalkthroughInProgress
      | PrUncommittedChanges
      | WorktreeError
    >;
    // Removes the PR's worktree, ending the shell in its Terminal first. Refuses one with changes
    // not committed unless `discard`, and one a Walkthrough is being written in.
    dismiss(
      root: string,
      number: number,
      options: { readonly discard: boolean },
    ): Effect.Effect<
      void,
      | ProjectNotFound
      | WorkspaceError
      | PullRequestsUnavailable
      | PrWalkthroughInProgress
      | PrUncommittedChanges
      | WorktreeError
    >;
    // The folder of the PR's worktree in the Project, for its Terminal, when it has one.
    worktree(pr: PrKey): Effect.Effect<Option.Option<string>>;
  }
>()("@repo/server/pullrequest/PullRequests") {
  static readonly layer = Layer.effect(
    PullRequests,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const hosted = yield* HostedSessions;
      const codeHost = yield* CodeHost;
      const git = yield* Git;
      const walkthroughs = yield* Walkthroughs;
      const worktrees = yield* PrWorktrees;
      const terminals = yield* Terminals;

      // Only a folder Fern knows as a Project has a Pull requests page.
      const known = (root: string) =>
        hosted.isProject(root).pipe(
          Effect.mapError((e) => new WorkspaceError({ message: e.message })),
          Effect.filterOrFail(
            (isProject) => isProject,
            () => new ProjectNotFound({ root }),
          ),
        );

      // Checked for GitHub before `gh`, so a repo off GitHub never runs it.
      const onGitHub = yield* Cache.make({
        capacity: 1024,
        timeToLive: REMEMBERED,
        lookup: (root: string) =>
          Effect.gen(function* () {
            const url = yield* git.run(root, ["remote", "get-url", "origin"]);
            const repo = gitHubRepo(url);
            if (Option.isNone(repo)) return Option.none<OnGitHub>();
            const login = yield* codeHost.login(root);
            return Option.some<OnGitHub>({ repo: repo.value, login });
          }).pipe(Effect.orElseSucceed(() => Option.none<OnGitHub>())),
      });

      // The Hosted Session holding each PR on its Stack, by the PR's URL.
      const holders = SqlSchema.findAll({
        Request: Schema.Array(Schema.String),
        Result: Schema.Struct({ session: Schema.String, url: Schema.String }),
        execute: (urls) =>
          sql`SELECT session_id AS session, url FROM stack_prs WHERE url IN ${sql.in(urls)}`,
      });
      const sessionsOf = (urls: ReadonlyArray<string>) =>
        urls.length === 0
          ? Effect.succeed(new Map<string, string>())
          : holders(urls).pipe(
              Effect.orDie,
              Effect.map(
                (rows) => new Map(rows.map((row) => [row.url, row.session])),
              ),
            );

      const available = Effect.fn("PullRequests.available")(function* (
        root: string,
      ) {
        yield* known(root);
        return new PullRequestsAvailability({
          available: Option.isSome(yield* Cache.get(onGitHub, root)),
        });
      });

      // The Project's repo on GitHub, and who `gh` is signed in as.
      const reached = (root: string) =>
        known(root).pipe(
          Effect.andThen(Cache.get(onGitHub, root)),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new PullRequestsUnavailable({ root })),
              onSome: Effect.succeed,
            }),
          ),
        );
      const refused = Effect.mapError(
        (e: { readonly message: string }) =>
          new PullRequestsError({ message: e.message }),
      );

      // Whether a Walkthrough of the PR is being written, in its worktree.
      const beingWritten = (repo: string, number: number) =>
        walkthroughs
          .foreignStates(repo)
          .pipe(
            Effect.map((states) =>
              states.some(
                (s) => s.number === number && s.walkthrough.state === "writing",
              ),
            ),
          );

      // A PR whose Terminal was never opened has no shell to end.
      const endShell = (pr: PrKey) =>
        terminals
          .kill(prTerminalKey(pr))
          .pipe(Effect.catchTag("TerminalError", () => Effect.void));

      // Removes the worktree of a PR that's closed or merged, unless the developer has to say so
      // first, as it has changes not committed, or it's in use: a Walkthrough is being written in
      // it, or its Terminal's shell is still running, which a later refresh finds ended or
      // dismissed. Whether it went.
      const tidy = (pr: PrKey) =>
        worktrees.exclusive(pr)(
          Effect.gen(function* () {
            if (yield* beingWritten(pr.repo, pr.number)) return false;
            if (yield* terminals.isRunning(prTerminalKey(pr))) return false;
            if (yield* worktrees.isDirty(pr)) return false;
            yield* endShell(pr);
            yield* worktrees.remove(pr, { force: false });
            return true;
          }),
        );

      // Whether GitHub has the PR closed or merged. Not when it can't say.
      const closedOnGitHub = (root: string, number: number) =>
        codeHost.pullRequest(root, number).pipe(
          Effect.map((pr) => pr.state !== "open"),
          Effect.orElseSucceed(() => false),
        );

      // The worktrees of the repo's PRs, each at the commit it's checked out at, once those of
      // PRs that have closed or merged are removed. In an open list, a PR missing from it is
      // asked of GitHub, unless its worktree has changes not committed, which keep it anyway.
      const worktreesOf = (
        root: string,
        repo: string,
        state: PrListState,
        prs: ReadonlyArray<HostPullRequest>,
      ) =>
        Effect.gen(function* () {
          const listed = new Map(prs.map((pr) => [pr.number, pr.state]));
          const found = new Map<number, PrWorktree>();
          for (const number of yield* worktrees.checkedOut(root, repo)) {
            const pr = { root, repo, number };
            const seen = listed.get(number);
            const closed =
              seen !== undefined
                ? seen !== "open"
                : state === "open" &&
                  !(yield* worktrees
                    .isDirty(pr)
                    .pipe(Effect.orElseSucceed(() => true))) &&
                  (yield* closedOnGitHub(root, number));
            const removed =
              closed &&
              (yield* tidy(pr).pipe(
                Effect.catch((error) =>
                  Effect.logWarning(
                    `Couldn't remove PR #${number}'s worktree`,
                    error.message,
                  ).pipe(Effect.as(false)),
                ),
              ));
            if (removed) continue;
            const head = yield* worktrees
              .head(pr)
              .pipe(Effect.orElseSucceed(() => Option.none<string>()));
            if (Option.isSome(head))
              found.set(number, new PrWorktree({ head: head.value }));
          }
          return found;
        });

      // How many commits a PR's head has that its Walkthrough's doesn't, by `root\0from\0to`. Two
      // commits always compare the same, so a count is kept for good; a failure is asked again
      // after a while.
      const ahead = yield* Cache.makeWith(
        (key: string) => {
          const [root = "", from = "", to = ""] = key.split("\0");
          return codeHost.commitsAhead(root, { from, to });
        },
        {
          capacity: 1024,
          timeToLive: (exit) =>
            Exit.isSuccess(exit) ? Duration.infinity : NOT_COUNTED,
        },
      );
      // Each Foreign PR's latest Walkthrough, with how many commits came since, once its PR's head
      // has moved on from a written one.
      const withNewCommits = (
        root: string,
        prs: ReadonlyArray<HostPullRequest>,
        latest: ReadonlyArray<PrWalkthroughOf>,
      ) => {
        const heads = new Map(prs.map((pr) => [pr.number, pr.headCommit]));
        return Effect.forEach(
          latest,
          ({ number, walkthrough }) => {
            const head = heads.get(number);
            const written =
              walkthrough.state === "unreviewed" ||
              walkthrough.state === "reviewed";
            if (!written || head === undefined || head === walkthrough.head)
              return Effect.succeed([number, walkthrough] as const);
            return Cache.get(
              ahead,
              `${root}\0${walkthrough.head}\0${head}`,
            ).pipe(
              Effect.option,
              Effect.map(
                (count) =>
                  [
                    number,
                    new PrWalkthrough({
                      state: walkthrough.state,
                      head: walkthrough.head,
                      error: walkthrough.error,
                      newCommits: Option.getOrUndefined(count),
                    }),
                  ] as const,
              ),
            );
          },
          { concurrency: COMPARING },
        );
      };

      const list = Effect.fn("PullRequests.list")(function* (
        root: string,
        state: PrListState,
      ) {
        const { repo, login } = yield* reached(root);
        const prs = yield* codeHost.pullRequests(root, state).pipe(refused);
        const [stacks, sessions, states, checkedOut] = yield* Effect.all(
          [
            codeHost.stacks(root, chained(prs)).pipe(refused),
            sessionsOf(prs.map((pr) => pr.url)),
            walkthroughs
              .foreignStates(repo)
              .pipe(
                Effect.flatMap((latest) => withNewCommits(root, prs, latest)),
              ),
            worktreesOf(root, repo, state, prs),
          ],
          { concurrency: "unbounded" },
        );
        return new PullRequestList({
          repo,
          login,
          ...grouped(prs, stacks, login, sessions, new Map(states), checkedOut),
        });
      });

      const commitOf = (root: string, ref: string) =>
        git
          .run(root, ["rev-parse", "--verify", "-q", `${ref}^{commit}`])
          .pipe(Effect.map((out) => out.trim()));
      // Any failure means no: then the Walkthrough covers the whole PR, which is never wrong.
      const isAncestor = (root: string, ancestor: string, of: string) =>
        git.run(root, ["merge-base", "--is-ancestor", ancestor, of]).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );

      // Writes the Walkthrough of the PR as GitHub last said it stands, `pr`. Its description, from
      // `described`, and the issue it says it closes are asked of GitHub only once it's to be
      // written. One at a time for each PR, so its worktree never moves while it's being read.
      // After its first, a PR's Walkthrough covers only what came since the last one written, when
      // that's honest: the PR's head grew from the last one's (no force-push), and the PR still
      // leaves its base where it did (the base didn't move). Otherwise, the whole PR again.
      const walkThroughIn = Effect.fn("PullRequests.walkThroughIn")(function* (
        root: string,
        repo: string,
        pr: Pick<HostPullRequest, "number" | "baseRef" | "headCommit">,
        described: Effect.Effect<HostPullRequestDetail, PullRequestsError>,
        queue?: string,
      ) {
        const { number } = pr;
        const key = { root, repo, number };
        return yield* worktrees.exclusive(key)(
          Effect.gen(function* () {
            const latest = (yield* walkthroughs.foreignStates(repo)).find(
              (s) => s.number === number,
            );
            if (latest?.walkthrough.state === "writing")
              return yield* new PrWalkthroughInProgress({ number });
            const previous = Option.getOrUndefined(
              yield* walkthroughs.lastWritten(repo, number),
            );
            if (previous?.head === pr.headCommit)
              return yield* new PrWalkthroughUpToDate({ number });
            const about = yield* described;
            yield* codeHost
              .fetchPullRequest(root, { number, base: pr.baseRef })
              .pipe(refused);
            const gitFailed = Effect.mapError(
              (e: { readonly message: string }) =>
                new WalkthroughError({ message: e.message }),
            );
            const [head, base] = yield* Effect.all([
              commitOf(root, prHeadRef(number)),
              commitOf(root, prBaseRef(number)),
            ]).pipe(gitFailed);
            if (previous?.head === head)
              return yield* new PrWalkthroughUpToDate({ number });
            const mergeBase = yield* git
              .run(root, ["merge-base", base, head])
              .pipe(
                Effect.map((out) => out.trim()),
                gitFailed,
              );
            // The Walkthrough this one follows on from, when it only covers what came since.
            const following =
              previous !== undefined &&
              previous.mergeBase === mergeBase &&
              (yield* isAncestor(root, previous.head, head))
                ? previous
                : undefined;
            const cwd = yield* worktrees.checkout(key, head).pipe(gitFailed);
            return yield* walkthroughs.writeForeign({
              project: root,
              cwd,
              pr: {
                repo,
                number,
                title: about.title,
                body: about.body,
                issue:
                  about.closes === undefined
                    ? undefined
                    : yield* codeHost.issue(root, about.closes),
              },
              since: following === undefined ? "pr" : "previous",
              from: following?.head ?? mergeBase,
              to: head,
              mergeBase,
              queue,
            });
          }),
        );
      });

      const walkThrough = Effect.fn("PullRequests.walkThrough")(function* (
        root: string,
        number: number,
      ) {
        const { repo } = yield* reached(root);
        const pr = yield* codeHost.pullRequest(root, number).pipe(refused);
        const held = (yield* sessionsOf([pr.url])).get(pr.url);
        if (held !== undefined)
          return yield* new PullRequestNotForeign({ number, session: held });
        return yield* walkThroughIn(root, repo, pr, Effect.succeed(pr));
      });

      // Each of the Stack's PRs in turn, bottom first, behind the one below, as the list has them:
      // GitHub is asked only for the description of each one written. Those that can't be walked
      // through as they stand are left alone, and anything else stops the run there.
      const walkThroughStack = Effect.fn("PullRequests.walkThroughStack")(
        function* (root: string, id: number, state: PrListState) {
          const listed = yield* list(root, state);
          const stack = listed.stacks.find((s) => s.id === id);
          if (stack === undefined) return yield* new PrStackNotFound({ id });
          const queue = `stack:${listed.repo}#${id}`;
          const started: Array<number> = [];
          const skipped: Array<number> = [];
          for (const pr of stack.prs) {
            const upToDate =
              pr.walkthrough !== undefined &&
              pr.walkthrough.state !== "failed" &&
              pr.walkthrough.head === pr.headCommit;
            const walked =
              pr.session !== undefined || upToDate
                ? false
                : yield* walkThroughIn(
                    root,
                    listed.repo,
                    pr,
                    codeHost.pullRequest(root, pr.number).pipe(refused),
                    queue,
                  ).pipe(
                    Effect.as(true),
                    Effect.catchTags({
                      PrWalkthroughInProgress: () => Effect.succeed(false),
                      PrWalkthroughUpToDate: () => Effect.succeed(false),
                      PrNothingToReview: () => Effect.succeed(false),
                    }),
                  );
            (walked ? started : skipped).push(pr.number);
          }
          return new PrStackWalkthrough({ started, skipped });
        },
      );

      // Asked of GitHub each time, as the PR may have closed, and only once nothing in Fern stands
      // in the way, so a review that can't go up never costs a call.
      const review = Effect.fn("PullRequests.review")(function* (
        root: string,
        number: number,
        walkthroughId: string,
      ) {
        const { repo, login } = yield* reached(root);
        const found = yield* walkthroughs.foreign(walkthroughId);
        if (found.repo !== repo || found.number !== number)
          return yield* new WalkthroughNotFound({ id: walkthroughId });
        const { walkthrough } = found;
        if (walkthrough.review !== undefined)
          return yield* new ReviewPostedAlready({
            id: walkthroughId,
            url: walkthrough.review.url,
          });
        if (walkthrough.reviewedAt === undefined)
          return yield* new WalkthroughNotReviewed({ id: walkthroughId });
        const pr = yield* codeHost.pullRequest(root, number).pipe(refused);
        if (pr.state !== "open")
          return yield* new PrNotOpen({ number, state: pr.state });
        // GitHub only shows the diff at the PR's head: once the PR has moved on from the
        // Walkthrough's, its notes go in the body alone.
        const diff =
          pr.headCommit === found.head
            ? yield* codeHost.pullRequestDiff(root, number).pipe(refused)
            : undefined;
        return PrReview.make({
          walkthrough: walkthroughId,
          commit: found.head,
          ...reviewOf(
            walkthrough,
            pr.author.toLowerCase() === login.toLowerCase(),
            found.earlier,
            diff,
          ),
        });
      });

      // One post at a time, so a Walkthrough's review can only go up once.
      const posting = yield* Semaphore.make(1);
      const postReview = Effect.fn("PullRequests.postReview")(function* (
        root: string,
        number: number,
        walkthroughId: string,
      ) {
        const { commit, event, body, comments } = yield* review(
          root,
          number,
          walkthroughId,
        );
        const posted = yield* codeHost
          .postReview(root, number, { commit, event, body, comments })
          .pipe(
            Effect.tapError((e) =>
              walkthroughs.reviewRefused(walkthroughId, e.message),
            ),
            refused,
          );
        yield* walkthroughs.reviewPosted(walkthroughId, posted);
        return PostedReview.make({
          url: posted.url,
          postedAt: DateTime.makeUnsafe(posted.postedAt),
        });
      }, posting.withPermits(1));
      const tryIt = Effect.fn("PullRequests.tryIt")(function* (
        root: string,
        number: number,
      ) {
        const { repo } = yield* reached(root);
        const pr = yield* codeHost.pullRequest(root, number).pipe(refused);
        const held = (yield* sessionsOf([pr.url])).get(pr.url);
        if (held !== undefined)
          return yield* new PullRequestNotForeign({ number, session: held });
        if (pr.state !== "open")
          return yield* new PrNotOpen({ number, state: pr.state });
        const key = { root, repo, number };
        return yield* worktrees.exclusive(key)(
          Effect.gen(function* () {
            yield* codeHost
              .fetchPullRequest(root, { number, base: pr.baseRef })
              .pipe(refused);
            const head = yield* commitOf(root, prHeadRef(number)).pipe(
              Effect.mapError(
                (e) => new PullRequestsError({ message: e.message }),
              ),
            );
            const at = yield* worktrees.head(key);
            if (Option.isSome(at) && at.value === head)
              return new PrWorktree({ head });
            if (yield* beingWritten(repo, number))
              return yield* new PrWalkthroughInProgress({ number });
            if (yield* worktrees.isDirty(key))
              return yield* new PrUncommittedChanges({ number });
            yield* worktrees.checkout(key, head);
            return new PrWorktree({ head });
          }),
        );
      });

      const dismiss = Effect.fn("PullRequests.dismiss")(function* (
        root: string,
        number: number,
        { discard }: { readonly discard: boolean },
      ) {
        const { repo } = yield* reached(root);
        const key = { root, repo, number };
        return yield* worktrees.exclusive(key)(
          Effect.gen(function* () {
            if (yield* beingWritten(repo, number))
              return yield* new PrWalkthroughInProgress({ number });
            if (!discard && (yield* worktrees.isDirty(key)))
              return yield* new PrUncommittedChanges({ number });
            yield* endShell(key);
            return yield* worktrees.remove(key, { force: discard });
          }),
        );
      });

      // Only of a folder Fern knows as a Project.
      const worktree = (pr: PrKey) =>
        known(pr.root).pipe(
          Effect.andThen(worktrees.head(pr)),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeedNone,
              onSome: () => worktrees.path(pr).pipe(Effect.asSome),
            }),
          ),
          Effect.orElseSucceed(() => Option.none<string>()),
        );

      return PullRequests.of({
        available,
        list,
        walkThrough,
        walkThroughStack,
        review,
        postReview,
        tryIt,
        dismiss,
        worktree,
      });
    }),
  ).pipe(Layer.provide(Git.layer));
}
