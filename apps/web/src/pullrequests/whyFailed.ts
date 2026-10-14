import { Predicate } from "effect";

// Why the PRs couldn't be listed, in plain words: GitHub's own when it gave some.
export const whyFailed = (error: unknown): string => {
  if (Predicate.isTagged(error, "PullRequestsError"))
    return Predicate.hasProperty(error, "message") &&
      typeof error.message === "string"
      ? error.message
      : "GitHub couldn't list the PRs.";
  if (Predicate.isTagged(error, "PullRequestsUnavailable"))
    return "Fern can't reach this repo on GitHub. Check that `gh` is signed in.";
  if (Predicate.isTagged(error, "ProjectNotFound"))
    return "Fern doesn't know this folder as a Project.";
  return "Couldn't reach Fern's server.";
};
