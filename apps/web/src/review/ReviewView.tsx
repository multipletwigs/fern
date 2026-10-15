import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useMemo } from "react";
import { walkthroughsAtom } from "../walkthrough/atoms";
import { ReviewOutcome } from "../walkthrough/ReviewOutcome";
import { WriteWalkthroughButton } from "../walkthrough/WriteWalkthroughButton";
import { reviewQueue, waitingCount } from "./queue";
import { ReviewEmpty } from "./ReviewEmpty";
import { ReviewQueue } from "./ReviewQueue";

// The Session's Review tab, in place of its transcript: its Walkthroughs to review item by item, or,
// before there are any, what will appear here.
export function ReviewView({
  sessionId,
  active,
}: {
  sessionId: string;
  active: boolean;
}) {
  const result = useAtomValue(walkthroughsAtom(sessionId));
  const walkthroughs = useMemo(
    () => (AsyncResult.isSuccess(result) ? result.value : []),
    [result],
  );
  const queue = useMemo(() => reviewQueue(walkthroughs), [walkthroughs]);
  return (
    <div className="absolute inset-0 z-[1] bg-panel">
      {queue.length === 0 ? (
        <ReviewEmpty sessionId={sessionId} />
      ) : (
        <ReviewQueue
          reviewKey={sessionId}
          walkthroughs={walkthroughs}
          queue={queue}
          waiting={waitingCount(walkthroughs)}
          active={active}
          actions={
            <WriteWalkthroughButton
              sessionId={sessionId}
              disabled={walkthroughs.some((w) => w.status === "writing")}
            />
          }
          outcome={ReviewOutcome}
        />
      )}
    </div>
  );
}
