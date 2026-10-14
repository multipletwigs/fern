import {
  ListedPullRequest,
  ListedStack,
  type PrNothingToReview,
  PostedReview,
  PrReview,
  PrStackPlace,
  type PrListState,
  type PrWalkthrough,
  PrWalkthroughInProgress,
  ProjectNotFound,
  PullRequestList,
  PullRequestNotForeign,
  PullRequestNotOpen,
  PullRequestsAvailability,
  PullRequestsError,
  PullRequestsUnavailable,
  ReviewPostedAlready,
  WalkthroughError,
  WalkthroughNotFound,
  WalkthroughNotReviewed,
  WorkspaceError,
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
import { HostedSessions } from "../turn/HostedSessions";
import { Walkthroughs } from "../walkthrough/Walkthroughs";
import { PrWorktrees } from "./PrWorktrees";
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
  | PullRequestNotOpen
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

      const list = Effect.fn("PullRequests.list")(function* (
        root: string,
        state: PrListState,
      ) {
        const { repo, login } = yield* reached(root);
        const prs = yield* codeHost.pullRequests(root, state).pipe(refused);
        const [stacks, sessions, states] = yield* Effect.all(
          [
            codeHost.stacks(root, chained(prs)).pipe(refused),
            sessionsOf(prs.map((pr) => pr.url)),
            walkthroughs.foreignStates(repo),
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
          return yield* new PullRequestNotOpen({ number });
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

      return PullRequests.of({
        available,
        list,
        walkThrough,
        review,
        postReview,
      });
    }),
  ).pipe(Layer.provide(Git.layer));
}
