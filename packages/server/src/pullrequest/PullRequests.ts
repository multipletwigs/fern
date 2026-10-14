import {
  ListedPullRequest,
  ListedStack,
  PrStackPlace,
  type PrListState,
  ProjectNotFound,
  PullRequestList,
  PullRequestsAvailability,
  PullRequestsError,
  PullRequestsUnavailable,
  WorkspaceError,
} from "@repo/api";
import { Cache, Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import {
  CodeHost,
  type HostPullRequest,
  type HostStack,
} from "../codehost/CodeHost";
import { gitHubRepo } from "../codehost/gitHubRepo";
import { Git } from "../git/Git";
import { HostedSessions } from "../turn/HostedSessions";

// How long Fern goes by what git and `gh` last said about a Project's repo: long enough that the
// sidebar asks once for every Project, short enough that signing in or out of `gh` soon shows.
const REMEMBERED = "30 seconds";

// Where a Project's PRs are on GitHub: its repo, and who `gh` is signed in as.
interface OnGitHub {
  readonly repo: string;
  readonly login: string;
}

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
  }
>()("@repo/server/pullrequest/PullRequests") {
  static readonly layer = Layer.effect(
    PullRequests,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const hosted = yield* HostedSessions;
      const codeHost = yield* CodeHost;
      const git = yield* Git;

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

      const list = Effect.fn("PullRequests.list")(function* (
        root: string,
        state: PrListState,
      ) {
        yield* known(root);
        const where = yield* Cache.get(onGitHub, root);
        if (Option.isNone(where))
          return yield* new PullRequestsUnavailable({ root });
        const { repo, login } = where.value;
        const refused = Effect.mapError(
          (e: { readonly message: string }) =>
            new PullRequestsError({ message: e.message }),
        );
        const prs = yield* codeHost.pullRequests(root, state).pipe(refused);
        const [stacks, sessions] = yield* Effect.all(
          [
            codeHost.stacks(root, chained(prs)).pipe(refused),
            sessionsOf(prs.map((pr) => pr.url)),
          ],
          { concurrency: "unbounded" },
        );
        return new PullRequestList({
          repo,
          login,
          ...grouped(prs, stacks, login, sessions),
        });
      });

      return PullRequests.of({ available, list });
    }),
  ).pipe(Layer.provide(Git.layer));
}
