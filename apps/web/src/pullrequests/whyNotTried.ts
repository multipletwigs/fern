import { Predicate } from "effect";

const messageOf = (error: unknown) =>
  Predicate.hasProperty(error, "message") && typeof error.message === "string"
    ? error.message
    : undefined;

// Why Fern couldn't check a Foreign PR out for Try it, or remove its worktree, in plain words:
// GitHub's or git's own when they gave some.
export const whyNotTried = (error: unknown): string => {
  if (Predicate.isTagged(error, "PrNotOpen"))
    return "This PR is closed or merged, so there's nothing to try.";
  if (Predicate.isTagged(error, "PrUncommittedChanges"))
    return "The PR has moved on, but its worktree has changes that aren't committed. Commit them, or dismiss the worktree to throw them away.";
  if (Predicate.isTagged(error, "PrWalkthroughInProgress"))
    return "A Walkthrough of this PR is being written in its worktree. Try again once it's written.";
  if (Predicate.isTagged(error, "PullRequestNotForeign"))
    return "This PR is on one of your Sessions' Stacks: run it in that Session.";
  if (Predicate.isTagged(error, "PullRequestsUnavailable"))
    return "Fern can't reach this repo on GitHub. Check that `gh` is signed in.";
  if (
    Predicate.isTagged(error, "PullRequestsError") ||
    Predicate.isTagged(error, "WorktreeError")
  )
    return messageOf(error) ?? "Couldn't check this PR out.";
  return "Couldn't reach Fern's server.";
};
