import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { ProjectNotFound, WorkspaceError } from "./Projects";
import { PrListState, PrState, PrWalkthroughState } from "./States";
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
// why writing it failed, when it did. Once the PR's head has moved on from it, the list also says
// how many commits the head has that the Walkthrough's doesn't, when GitHub could count them.
export class PrWalkthrough extends Schema.Class<PrWalkthrough>("PrWalkthrough")(
  {
    state: PrWalkthroughState,
    head: Schema.String,
    error: Schema.optional(Schema.String),
    newCommits: Schema.optional(Schema.Int),
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

// A Project's PRs, open or closed: its Stacks, newest first, each bottom first, then the PRs in no
// Stack. Every PR is in it once.
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

// The PR's latest Walkthrough is at its head already: there is nothing new to walk through.
export class PrWalkthroughUpToDate extends Schema.TaggedError<PrWalkthroughUpToDate>()(
  "PrWalkthroughUpToDate",
  { number: Schema.Int },
  { httpApiStatus: 409 },
) {}

// The Stack isn't among the Project's PRs in the state asked for.
export class PrStackNotFound extends Schema.TaggedError<PrStackNotFound>()(
  "PrStackNotFound",
  { id: Schema.Int },
  { httpApiStatus: 404 },
) {}

// What Walk through Stack did, by PR number, bottom first: the PRs whose Walkthroughs it started,
// and those it left alone, as up to date, being written already, a Hosted Session's, or changing
// nothing.
export class PrStackWalkthrough extends Schema.Class<PrStackWalkthrough>(
  "PrStackWalkthrough",
)({
  started: Schema.Array(Schema.Int),
  skipped: Schema.Array(Schema.Int),
}) {}

// A PR number, as a path parameter: a positive whole number.
const PrNumber = Schema.NumberFromString.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
);

// A Stack's id on GitHub, as a path parameter: a positive whole number too.
const StackId = PrNumber;

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
    // The Project's PRs in one `state`, asked of GitHub each time: the open ones, or the closed
    // ones with the merged ones.
    HttpApiEndpoint.get("list", "/", {
      query: { root: Schema.NonEmptyString, state: PrListState },
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
    // Starts writing a Walkthrough of a Foreign PR at its head: a fresh read-only agent reads the
    // PR in a worktree of its own, never the developer's checkout (ADR 0010). The first covers the
    // PR from where it leaves its base. A later one covers only the commits since the previous one,
    // unless the PR was force-pushed or its base moved, when it covers the whole PR again. Until
    // it's written, the PR shows its Walkthrough as being written.
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
        PrWalkthroughUpToDate,
        PrNothingToReview,
        WalkthroughError,
      ],
    }),
  )
  .add(
    // Walks through each Foreign PR of the Stack, as the list in `state` holds it, bottom first,
    // one at a time, as Walk through does: skipping those up to date or being written already.
    HttpApiEndpoint.post("walkThroughStack", "/stacks/:id/walkthrough", {
      params: { id: StackId },
      payload: Schema.Struct({
        root: Schema.NonEmptyString,
        state: PrListState,
      }),
      success: PrStackWalkthrough,
      error: [
        ProjectNotFound,
        WorkspaceError,
        PullRequestsUnavailable,
        PullRequestsError,
        PrStackNotFound,
        WalkthroughError,
      ],
    }),
  )
  .prefix("/pull-requests") {}
