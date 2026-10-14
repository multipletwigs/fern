import { useAtomSet } from "@effect/atom-react";
import type { ListedPullRequest } from "@repo/api";
import { PullRequestItem } from "@repo/ui/PullRequestItem";
import { showReviewAtom } from "../review/atoms";
import { selectedSessionAtom } from "../session/atoms";
import { newSessionAtom } from "../workspace/showing";

// A PR on a Hosted Session's Stack, on the Pull requests page: opening it shows the Session, on
// its Review tab, at the PR.
export function SessionPr({
  pr,
  session,
  sessionTitle,
}: {
  pr: ListedPullRequest;
  session: string;
  sessionTitle: string | undefined;
}) {
  const setSelected = useAtomSet(selectedSessionAtom);
  const setNew = useAtomSet(newSessionAtom);
  const showReview = useAtomSet(showReviewAtom(session));
  return (
    <PullRequestItem
      number={pr.number}
      title={pr.title}
      author={pr.author}
      url={pr.url}
      draft={pr.draft}
      reviewRequested={pr.reviewRequested}
      session={sessionTitle ?? "Hosted Session"}
      onOpen={() => {
        showReview({ pr: pr.number });
        setSelected(session);
        setNew(undefined);
      }}
    />
  );
}
