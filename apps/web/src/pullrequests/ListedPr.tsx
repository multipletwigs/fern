import type { ListedPullRequest } from "@repo/api";
import { PullRequestItem } from "@repo/ui/PullRequestItem";
import { SessionPr } from "./SessionPr";

// A PR on the Pull requests page. One a Hosted Session holds opens that Session's Review tab on
// it; a Foreign PR opens on GitHub, until Fern writes Walkthroughs of its own.
export function ListedPr({
  pr,
  sessionTitle,
  dimmed,
}: {
  pr: ListedPullRequest;
  // What the sidebar calls the Session holding it, when one does.
  sessionTitle: string | undefined;
  // Shown only for the Stack it's in, as the filters leave it out.
  dimmed: boolean;
}) {
  return pr.session === undefined ? (
    <PullRequestItem
      number={pr.number}
      title={pr.title}
      author={pr.author}
      url={pr.url}
      draft={pr.draft}
      reviewRequested={pr.reviewRequested}
      state={pr.state}
      dimmed={dimmed}
    />
  ) : (
    <SessionPr
      pr={pr}
      session={pr.session}
      sessionTitle={sessionTitle}
      dimmed={dimmed}
    />
  );
}
