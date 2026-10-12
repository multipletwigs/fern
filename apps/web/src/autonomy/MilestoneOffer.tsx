import { useAtomSet } from "@effect/atom-react";
import type { Milestone } from "@repo/api";
import { MilestoneCard } from "@repo/ui/MilestoneCard";
import { Exit } from "effect";
import { useState } from "react";
import { PHASE_TITLES } from "../flow/phases";
import { acceptMilestoneAtom, declineMilestoneAtom } from "./atoms";

// One Milestone offering Autonomy at a boundary, for the developer to accept or decline.
export function MilestoneOffer({
  milestone,
  threshold,
}: {
  milestone: Milestone;
  threshold: number;
}) {
  const accept = useAtomSet(acceptMilestoneAtom, { mode: "promiseExit" });
  const decline = useAtomSet(declineMilestoneAtom, { mode: "promiseExit" });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const phase = PHASE_TITLES[milestone.boundary];

  const decide = async (run: () => Promise<Exit.Exit<unknown, unknown>>) => {
    setPending(true);
    const exit = await run();
    setPending(false);
    setFailed(Exit.isFailure(exit));
  };
  return (
    <MilestoneCard
      title={`${threshold} clean ${phase} approvals in a row`}
      offer={`Let Fern approve the end of ${phase} in this Project from now on? An Escape past it takes it back.`}
      pending={pending}
      failed={failed}
      onAccept={() =>
        void decide(() => accept({ params: { id: milestone.id } }))
      }
      onDecline={() =>
        void decide(() => decline({ params: { id: milestone.id } }))
      }
    />
  );
}
