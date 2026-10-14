import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { ProjectNotFound, WorkspaceError } from "./Projects";
import {
  PrListState,
  PrReviewEvent,
  PrState,
  PrWalkthroughState,
} from "./States";
import {
  PostedReview,
  WalkthroughError,
  WalkthroughNotFound,
} from "./Walkthroughs";

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

// Which side of a PR's diff a review comment is on: the line as the PR leaves it, or, for a line it
// removes, as it was.
export const DiffSide = Schema.Literals(["RIGHT", "LEFT"]);
export type DiffSide = typeof DiffSide.Type;

// One Rejection note, as a review posts it on the line it's about.
export class PrReviewComment extends Schema.Class<PrReviewComment>(
  "PrReviewComment",
)({
  // Relative to the repository's root.
  path: Schema.String,
  // The line's number in the file on that `side`.
  line: Schema.Int,
  side: DiffSide,
  body: Schema.String,
}) {}

// The review that Post review would put on a Foreign PR for one of its Reviewed Walkthroughs,
// exactly as GitHub gets it: on the head commit the Walkthrough explains, approving or requesting
// changes (a plain comment on the developer's own PR), its body listing every Rejection, and each
// Section's Rejection note again on the Section's first changed line.
export class PrReview extends Schema.Class<PrReview>("PrReview")({
  walkthrough: Schema.String,
  commit: Schema.String,
  event: PrReviewEvent,
  body: Schema.String,
  comments: Schema.Array(PrReviewComment),
}) {}

// Only an open PR is reviewed.
export class PullRequestNotOpen extends Schema.TaggedError<PullRequestNotOpen>()(
  "PullRequestNotOpen",
  { number: Schema.Int },
  { httpApiStatus: 409 },
) {}

// The Walkthrough still waits on verdicts, or was never written: there's nothing to post yet.
export class WalkthroughNotReviewed extends Schema.TaggedError<WalkthroughNotReviewed>()(
  "WalkthroughNotReviewed",
  { id: Schema.String },
  { httpApiStatus: 409 },
) {}

// The Walkthrough's review is on GitHub already, at `url`: a Walkthrough is posted once.
export class ReviewPostedAlready extends Schema.TaggedError<ReviewPostedAlready>()(
  "ReviewPostedAlready",
  { id: Schema.String, url: Schema.String },
  { httpApiStatus: 409 },
) {}

const ReviewErrors = [
  ProjectNotFound,
  WorkspaceError,
  PullRequestsUnavailable,
  PullRequestsError,
  WalkthroughNotFound,
  PullRequestNotOpen,
  WalkthroughNotReviewed,
  ReviewPostedAlready,
];

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
  .add(
    // The review Post review would put on the PR for one of its Foreign PR Walkthroughs, for the
    // developer to read before they confirm. Posts nothing.
    HttpApiEndpoint.get("review", "/:number/review", {
      params: { number: PrNumber },
      query: {
        root: Schema.NonEmptyString,
        walkthrough: Schema.NonEmptyString,
      },
      success: PrReview,
      error: ReviewErrors,
    }),
  )
  .add(
    // Posts the Walkthrough's review, as `review` shows it, on the PR on GitHub: only once the
    // developer confirms, only for a Reviewed Walkthrough of an open PR, and only once. A refusal
    // keeps GitHub's reason on the Walkthrough, and posting can be tried again.
    HttpApiEndpoint.post("postReview", "/:number/review", {
      params: { number: PrNumber },
      payload: Schema.Struct({
        root: Schema.NonEmptyString,
        walkthrough: Schema.NonEmptyString,
      }),
      success: PostedReview,
      error: ReviewErrors,
    }),
  )
  .prefix("/pull-requests") {}
