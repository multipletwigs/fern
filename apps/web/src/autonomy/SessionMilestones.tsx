import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { autonomyAtom } from "./atoms";
import { MilestoneOffer } from "./MilestoneOffer";

// The Milestones waiting on the developer in the Session's Project, above its composer.
export function SessionMilestones({ sessionId }: { sessionId: string }) {
  const result = useAtomValue(autonomyAtom(sessionId));
  const autonomy = AsyncResult.isSuccess(result) ? result.value : null;
  if (!autonomy) return null;
  return (
    <>
      {autonomy.boundaries.flatMap(({ offer, threshold }) =>
        offer
          ? [
              <MilestoneOffer
                key={offer.id}
                milestone={offer}
                threshold={threshold}
              />,
            ]
          : [],
      )}
    </>
  );
}
