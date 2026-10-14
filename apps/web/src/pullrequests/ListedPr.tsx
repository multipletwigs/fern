import type { ListedPullRequest, PrWalkthrough } from "@repo/api";
import { PullRequestItem } from "@repo/ui/PullRequestItem";
import { walkthroughMark } from "./prWalkthroughs";
import { SessionPr } from "./SessionPr";

// A PR on the Pull requests page. One a Hosted Session holds opens that Session's Review tab on
// it; a Foreign PR opens its Walkthroughs on the page through `onOpen`, marked with where its latest
// stands, as of the PR's head now.
export function ListedPr({
  pr,
  sessionTitle,
  dimmed,
  walkthrough,
  onOpen,
}: {
  pr: ListedPullRequest;
  // What the sidebar calls the Session holding it, when one does.
  sessionTitle: string | undefined;
  // Shown only for the Stack it's in, as the filters leave it out.
  dimmed: boolean;
  // A Foreign PR's latest Walkthrough, as it stands now.
  walkthrough: PrWalkthrough | undefined;
  onOpen: () => void;
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
      walkthrough={walkthrough && walkthroughMark(walkthrough, pr.headCommit)}
      dimmed={dimmed}
      onOpen={onOpen}
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
