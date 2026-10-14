import { Predicate } from "effect";

const messageOf = (error: unknown) =>
  Predicate.hasProperty(error, "message") && typeof error.message === "string"
    ? error.message
    : undefined;

// Why Fern couldn't show or post a Foreign PR's review, in plain words: GitHub's own when it gave
// some.
export const whyNotPosted = (error: unknown): string => {
  if (Predicate.isTagged(error, "ReviewPostedAlready"))
    return "This review is on GitHub already.";
  if (Predicate.isTagged(error, "WalkthroughNotReviewed"))
    return "Give every Section and Unexplained change a verdict first.";
  if (Predicate.isTagged(error, "PullRequestNotOpen"))
    return "This PR isn't open any more, so it can't be reviewed.";
  if (Predicate.isTagged(error, "WalkthroughNotFound"))
    return "Fern no longer has this Walkthrough.";
  if (Predicate.isTagged(error, "PullRequestsUnavailable"))
    return "Fern can't reach this repo on GitHub. Check that `gh` is signed in.";
  if (Predicate.isTagged(error, "PullRequestsError"))
    return `GitHub refused the review. ${messageOf(error) ?? ""}`.trim();
  return "Couldn't reach Fern's server.";
};
