import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { type RefObject, useMemo } from "react";
import { walkthroughsAtom } from "../walkthrough/atoms";
import { reviewQueue, waitingCount } from "./queue";
import { ReviewEmpty } from "./ReviewEmpty";
import { ReviewQueue } from "./ReviewQueue";

// The Session's Review tab, in place of its transcript: its Walkthroughs to review item by item, or,
// before there are any, what will appear here.
export function ReviewView({
  sessionId,
  active,
  composerField,
}: {
  sessionId: string;
  active: boolean;
  composerField: RefObject<HTMLTextAreaElement | null>;
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
          sessionId={sessionId}
          walkthroughs={walkthroughs}
          queue={queue}
          waiting={waitingCount(walkthroughs)}
          active={active}
          composerField={composerField}
        />
      )}
    </div>
  );
}
