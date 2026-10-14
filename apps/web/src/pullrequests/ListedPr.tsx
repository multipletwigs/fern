import type { ListedPullRequest } from "@repo/api";
import { PullRequestItem } from "@repo/ui/PullRequestItem";
import { SessionPr } from "./SessionPr";

// A PR on the Pull requests page. One a Hosted Session holds opens that Session's Review tab on
// it; a Foreign PR opens on GitHub, until Fern writes Walkthroughs of its own.
export function ListedPr({
  pr,
  sessionTitle,
}: {
  pr: ListedPullRequest;
  // What the sidebar calls the Session holding it, when one does.
  sessionTitle: string | undefined;
}) {
  return pr.session === undefined ? (
    <PullRequestItem
      number={pr.number}
      title={pr.title}
      author={pr.author}
      url={pr.url}
      draft={pr.draft}
      reviewRequested={pr.reviewRequested}
    />
  ) : (
    <SessionPr pr={pr} session={pr.session} sessionTitle={sessionTitle} />
  );
}
