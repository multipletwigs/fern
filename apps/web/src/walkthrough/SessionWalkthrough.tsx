import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { WalkthroughStatus } from "@repo/ui/WalkthroughStatus";
import { AsyncResult } from "effect/reactivity";
import { showReviewAtom } from "../review/atoms";
import { walkthroughsAtom } from "./atoms";
import { openItems } from "./review";

// The Session's latest Walkthrough above its composer while Claude writes it, while it waits on a
// review, or when it failed, so writing one never goes unnoticed. Clicking it opens the Review tab
// on it.
export function SessionWalkthrough({ sessionId }: { sessionId: string }) {
  const result = useAtomValue(walkthroughsAtom(sessionId));
  const open = useAtomSet(showReviewAtom(sessionId));
  const latest = AsyncResult.isSuccess(result)
    ? result.value.at(-1)
    : undefined;
  if (!latest) return null;
  const waiting = openItems(latest);
  if (latest.status === "ready" && (latest.reviewedAt || waiting === 0))
    return null;
  return (
    <WalkthroughStatus
      number={latest.number}
      status={latest.status}
      open={waiting}
      onOpen={() => open({ walkthrough: latest.id })}
    />
  );
}
