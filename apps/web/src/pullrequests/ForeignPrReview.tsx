import { useAtomValue } from "@effect/atom-react";
import type { ListedPullRequest } from "@repo/api";
import { PullRequestReviewPanel } from "@repo/ui/PullRequestReviewPanel";
import { AsyncResult } from "effect/reactivity";
import { useMemo } from "react";
import { reviewQueue, waitingCount } from "../review/queue";
import { ReviewQueue } from "../review/ReviewQueue";
import { prReviewKey, prWalkthroughsAtom } from "./atoms";
import { ForeignPrEmpty } from "./ForeignPrEmpty";
import { ForeignReviewOutcome } from "./ForeignReviewOutcome";
import { WalkThroughButton } from "./WalkThroughButton";

// A Foreign PR open on the Pull requests page: its Walkthroughs in the Review layout, with the same
// keys as a Session's Review tab, or, before there are any, a way to ask for one. Verdicts stay in
// Fern.
export function ForeignPrReview({
  root,
  repo,
  number,
  pr,
  onBack,
}: {
  root: string;
  // The repo on GitHub, as "owner/name".
  repo: string;
  number: number;
  // The PR as last listed, when the list still has it.
  pr: ListedPullRequest | undefined;
  onBack: () => void;
}) {
  const key = prReviewKey(repo, number);
  const result = useAtomValue(prWalkthroughsAtom(key));
  const walkthroughs = useMemo(
    () => (AsyncResult.isSuccess(result) ? result.value : []),
    [result],
  );
  const queue = useMemo(() => reviewQueue(walkthroughs), [walkthroughs]);
  const writing = walkthroughs.some((w) => w.status === "writing");
  return (
    <PullRequestReviewPanel
      number={number}
      title={pr?.title}
      url={pr?.url ?? `https://github.com/${repo}/pull/${number}`}
      onBack={onBack}
    >
      {queue.length === 0 ? (
        <ForeignPrEmpty
          loading={!AsyncResult.isSuccess(result)}
          action={
            <WalkThroughButton
              root={root}
              number={number}
              label="Walk through"
            />
          }
        />
      ) : (
        <ReviewQueue
          reviewKey={key}
          walkthroughs={walkthroughs}
          queue={queue}
          waiting={waitingCount(walkthroughs)}
          active
          actions={
            <WalkThroughButton
              root={root}
              number={number}
              label="Walk through again"
              disabled={writing}
            />
          }
          renderOutcome={(walkthrough) => (
            <ForeignReviewOutcome
              walkthrough={walkthrough}
              root={root}
              number={number}
              open={pr?.state === "open"}
            />
          )}
          retry={
            <WalkThroughButton
              root={root}
              number={number}
              label="Walk through again"
              disabled={writing}
            />
          }
        />
      )}
    </PullRequestReviewPanel>
  );
}
