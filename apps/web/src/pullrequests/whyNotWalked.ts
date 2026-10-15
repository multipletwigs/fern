import { Predicate } from "effect";

const messageOf = (error: unknown) =>
  Predicate.hasProperty(error, "message") && typeof error.message === "string"
    ? error.message
    : undefined;

// Why Fern couldn't start a Walkthrough of a Foreign PR, in plain words: GitHub's or git's own when
// they gave some.
export const whyNotWalked = (error: unknown): string => {
  if (Predicate.isTagged(error, "PrWalkthroughInProgress"))
    return "A Walkthrough of this PR is being written already.";
  if (Predicate.isTagged(error, "PrNothingToReview"))
    return "This PR changes nothing from where it leaves its base.";
  if (Predicate.isTagged(error, "PullRequestNotForeign"))
    return "This PR is on one of your Sessions' Stacks: review it in that Session.";
  if (Predicate.isTagged(error, "PullRequestsUnavailable"))
    return "Fern can't reach this repo on GitHub. Check that `gh` is signed in.";
  if (
    Predicate.isTagged(error, "PullRequestsError") ||
    Predicate.isTagged(error, "WalkthroughError")
  )
    return messageOf(error) ?? "Couldn't start a Walkthrough of this PR.";
  return "Couldn't reach Fern's server.";
};
