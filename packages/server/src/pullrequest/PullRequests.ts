import {
  ListedPullRequest,
  ListedStack,
  type PrNothingToReview,
  PostedReview,
  PrReview,
  PrNotOpen,
  PrStackPlace,
  type PrListState,
  PrUncommittedChanges,
  type PrWalkthrough,
  PrWalkthroughInProgress,
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
  Effect,
  Layer,
  Option,
  Schema,
  Semaphore,
} from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import {
  CodeHost,
  type HostPullRequest,
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
      | PrNothingToReview
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
    // The folder of the PR's worktree, for its Terminal, when it has one.
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
      // first, as it has changes not committed, or a Walkthrough is being written in it. Whether
      // it went.
      const tidy = (root: string, pr: PrKey) =>
        worktrees.exclusive(pr)(
          Effect.gen(function* () {
            if (yield* beingWritten(pr.repo, pr.number)) return false;
            if (yield* worktrees.isDirty(pr)) return false;
            yield* endShell(pr);
            yield* worktrees.remove(root, pr, { force: false });
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
          for (const number of yield* worktrees.checkedOut(repo)) {
            const pr = { repo, number };
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
              (yield* tidy(root, pr).pipe(
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
            walkthroughs.foreignStates(repo),
            worktreesOf(root, repo, state, prs),
          ],
          { concurrency: "unbounded" },
        );
        return new PullRequestList({
          repo,
          login,
          ...grouped(
            prs,
            stacks,
            login,
            sessions,
            new Map(states.map((s) => [s.number, s.walkthrough])),
            checkedOut,
          ),
        });
      });

      const commitOf = (root: string, ref: string) =>
        git
          .run(root, ["rev-parse", "--verify", "-q", `${ref}^{commit}`])
          .pipe(Effect.map((out) => out.trim()));

      // One at a time for each PR, so its worktree never moves while it's being read.
      const walkThrough = Effect.fn("PullRequests.walkThrough")(function* (
        root: string,
        number: number,
      ) {
        const { repo } = yield* reached(root);
        const pr = yield* codeHost.pullRequest(root, number).pipe(refused);
        const held = (yield* sessionsOf([pr.url])).get(pr.url);
        if (held !== undefined)
          return yield* new PullRequestNotForeign({ number, session: held });
        const key = { repo, number };
        return yield* worktrees.exclusive(key)(
          Effect.gen(function* () {
            const latest = (yield* walkthroughs.foreignStates(repo)).find(
              (s) => s.number === number,
            );
            if (latest?.walkthrough.state === "writing")
              return yield* new PrWalkthroughInProgress({ number });
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
            const mergeBase = yield* git
              .run(root, ["merge-base", base, head])
              .pipe(
                Effect.map((out) => out.trim()),
                gitFailed,
              );
            const cwd = yield* worktrees
              .checkout(root, key, head)
              .pipe(gitFailed);
            return yield* walkthroughs.writeForeign({
              project: root,
              cwd,
              pr: {
                repo,
                number,
                title: pr.title,
                body: pr.body,
                issue: pr.issue,
              },
              from: mergeBase,
              to: head,
              mergeBase,
            });
          }),
        );
      });

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
        return PrReview.make({
          walkthrough: walkthroughId,
          commit: found.head,
          ...reviewOf(
            walkthrough,
            pr.author.toLowerCase() === login.toLowerCase(),
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
        const key = { repo, number };
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
            yield* worktrees.checkout(root, key, head);
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
        const key = { repo, number };
        return yield* worktrees.exclusive(key)(
          Effect.gen(function* () {
            if (yield* beingWritten(repo, number))
              return yield* new PrWalkthroughInProgress({ number });
            if (!discard && (yield* worktrees.isDirty(key)))
              return yield* new PrUncommittedChanges({ number });
            yield* endShell(key);
            return yield* worktrees.remove(root, key, { force: discard });
          }),
        );
      });

      const worktree = (pr: PrKey) =>
        worktrees.head(pr).pipe(
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
        review,
        postReview,
        tryIt,
        dismiss,
        worktree,
      });
    }),
  ).pipe(Layer.provide(Git.layer));
}
