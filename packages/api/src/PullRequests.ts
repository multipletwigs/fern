import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { ProjectNotFound, WorkspaceError } from "./Projects";
import { PrState, PrWalkthroughState } from "./States";
import { WalkthroughError } from "./Walkthroughs";

// A Project's pull requests on GitHub, for its Pull requests page: every PR on the repo, whoever
// wrote it, grouped into the GitHub Stacks they form. A PR one of Fern's Hosted Sessions holds on
// its Stack carries that Session; every other PR is a Foreign PR.

// Where a PR sits in its GitHub Stack.
export class PrStackPlace extends Schema.Class<PrStackPlace>("PrStackPlace")({
  // GitHub's id for the Stack, the same for every PR in it.
  id: Schema.Int,
  // 1 for the bottom PR, the one based on the Stack's base branch.
  position: Schema.Int,
}) {}

// A repo on GitHub, as "owner/name".
export const GitHubRepoName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/),
);

// Where a Foreign PR's latest Walkthrough stands: its state, the PR's head commit it explains, and
// why writing it failed, when it did.
export class PrWalkthrough extends Schema.Class<PrWalkthrough>("PrWalkthrough")(
  {
    state: PrWalkthroughState,
    head: Schema.String,
    error: Schema.optional(Schema.String),
  },
) {}

// A Foreign PR's latest Walkthrough, by the PR's number.
export class PrWalkthroughOf extends Schema.Class<PrWalkthroughOf>(
  "PrWalkthroughOf",
)({
  number: Schema.Int,
  walkthrough: PrWalkthrough,
}) {}

// One pull request on the Project's repo, as GitHub has it.
export class ListedPullRequest extends Schema.Class<ListedPullRequest>(
  "ListedPullRequest",
)({
  number: Schema.Int,
  url: Schema.String,
  title: Schema.String,
  // The GitHub login of whoever opened it.
  author: Schema.String,
  // The branch it merges, and the branch it merges into.
  headRef: Schema.String,
  baseRef: Schema.String,
  // The commit its head branch points at.
  headCommit: Schema.String,
  draft: Schema.Boolean,
  state: PrState,
  // Whether the developer, as `gh` is signed in, is asked to review it.
  reviewRequested: Schema.Boolean,
  // Its GitHub Stack, when it's in one.
  stack: Schema.optional(PrStackPlace),
  // The Hosted Session whose Stack holds it, when one does.
  session: Schema.optional(Schema.String),
  // Its latest Walkthrough, when it's a Foreign PR with one.
  walkthrough: Schema.optional(PrWalkthrough),
}) {}

// A GitHub Stack of the repo's PRs, bottom first: only those the list holds.
export class ListedStack extends Schema.Class<ListedStack>("ListedStack")({
  id: Schema.Int,
  // The Stack's number on the repo, as GitHub shows it.
  number: Schema.Int,
  prs: Schema.Array(ListedPullRequest),
}) {}

// A Project's open PRs: its Stacks, newest first, each bottom first, then the PRs in no Stack.
// Every PR is in it once.
export class PullRequestList extends Schema.Class<PullRequestList>(
  "PullRequestList",
)({
  // The repo on GitHub, as "owner/name".
  repo: Schema.String,
  // The developer's GitHub login, as `gh` is signed in.
  login: Schema.String,
  stacks: Schema.Array(ListedStack),
  lone: Schema.Array(ListedPullRequest),
}) {}

// Whether the Project has a Pull requests page.
export class PullRequestsAvailability extends Schema.Class<PullRequestsAvailability>(
  "PullRequestsAvailability",
)({
  available: Schema.Boolean,
}) {}

// The Project has no Pull requests page: its `origin` isn't on GitHub, or `gh` isn't signed in.
export class PullRequestsUnavailable extends Schema.TaggedError<PullRequestsUnavailable>()(
  "PullRequestsUnavailable",
  { root: Schema.String },
  { httpApiStatus: 409 },
) {}

// GitHub couldn't list the PRs, with why in plain words.
export class PullRequestsError extends Schema.TaggedError<PullRequestsError>()(
  "PullRequestsError",
  { message: Schema.String },
  { httpApiStatus: 502 },
) {}

// The PR is on a Hosted Session's Stack, so its Walkthroughs are that Session's: it gets no Foreign
// PR Walkthrough.
export class PullRequestNotForeign extends Schema.TaggedError<PullRequestNotForeign>()(
  "PullRequestNotForeign",
  { number: Schema.Int, session: Schema.String },
  { httpApiStatus: 409 },
) {}

// A Walkthrough of the PR is being written already.
export class PrWalkthroughInProgress extends Schema.TaggedError<PrWalkthroughInProgress>()(
  "PrWalkthroughInProgress",
  { number: Schema.Int },
  { httpApiStatus: 409 },
) {}

// The PR changes nothing from where it leaves its base, so there is nothing to explain.
export class PrNothingToReview extends Schema.TaggedError<PrNothingToReview>()(
  "PrNothingToReview",
  { number: Schema.Int },
  { httpApiStatus: 409 },
) {}

// A PR number, as a path parameter: a positive whole number.
const PrNumber = Schema.NumberFromString.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
);

export class PullRequestsApi extends HttpApiGroup.make("pullRequests")
  .add(
    // Whether the Project has a Pull requests page: its `origin` is on GitHub and `gh` is signed
    // in. Never fails for a Project Fern knows; anything it can't tell means no.
    HttpApiEndpoint.get("available", "/available", {
      query: { root: Schema.NonEmptyString },
      success: PullRequestsAvailability,
      error: [ProjectNotFound, WorkspaceError],
    }),
  )
  .add(
    // The Project's open PRs, asked of GitHub each time.
    HttpApiEndpoint.get("list", "/", {
      query: { root: Schema.NonEmptyString },
      success: PullRequestList,
      error: [
        ProjectNotFound,
        WorkspaceError,
        PullRequestsUnavailable,
        PullRequestsError,
      ],
    }),
  )
  .add(
    // Starts writing a Walkthrough of a Foreign PR, of its head from where it leaves its base: a
    // fresh read-only agent reads the PR in a worktree of its own, never the developer's checkout
    // (ADR 0010). Until it's written, the PR shows its Walkthrough as being written.
    HttpApiEndpoint.post("walkThrough", "/:number/walkthrough", {
      params: { number: PrNumber },
      payload: Schema.Struct({ root: Schema.NonEmptyString }),
      success: HttpApiSchema.NoContent,
      error: [
        ProjectNotFound,
        WorkspaceError,
        PullRequestsUnavailable,
        PullRequestsError,
        PullRequestNotForeign,
        PrWalkthroughInProgress,
        PrNothingToReview,
        WalkthroughError,
      ],
    }),
  )
  .prefix("/pull-requests") {}
