import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { type BoundaryAutonomy, type Phase, PHASES } from "@repo/api";
import { AutonomyWithdrawn } from "@repo/ui/AutonomyWithdrawn";
import type { BoundaryState } from "@repo/ui/FlowBoundary";
import { FlowChecklist } from "@repo/ui/FlowChecklist";
import { SkipPhase } from "@repo/ui/SkipPhase";
import { Exit } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { autonomyAtom } from "../autonomy/atoms";
import { flowAtom, skipPhaseAtom } from "./atoms";
import { PHASE_TITLES } from "./phases";

// Who passes the boundary at the end of a Phase: the developer, with the streak where Autonomy
// can be earned, or Fern. Once an Escape withdraws Autonomy, the boundary says so with the streak
// started over, even where Fern approved it.
const boundaryState = (at: BoundaryAutonomy | undefined): BoundaryState => {
  if (at === undefined) return { kind: "needsYou" };
  const streak = { count: at.streak, threshold: at.threshold };
  if (at.withdrawn && !at.granted)
    return { kind: "withdrawn", reason: at.withdrawn.reason, streak };
  if (at.approvedByFern) return { kind: "approvedByFern" };
  if (at.granted) return { kind: "byFern" };
  return { kind: "needsYou", streak };
};

// "Spec → Implement" for the boundary at the end of Spec.
const boundaryTitle = (phase: Phase) => {
  const next = PHASES[PHASES.indexOf(phase) + 1];
  return next
    ? `${PHASE_TITLES[phase]} → ${PHASE_TITLES[next]}`
    : PHASE_TITLES[phase];
};

// The Session's Flow, pinned at the top of the Session; nothing for a Session outside the Flow.
// The current Phase can be skipped with a reason, unless it's waiting at a Checkpoint.
export function SessionChecklist({ sessionId }: { sessionId: string }) {
  const result = useAtomValue(flowAtom(sessionId));
  const autonomyResult = useAtomValue(autonomyAtom(sessionId));
  const skip = useAtomSet(skipPhaseAtom, { mode: "promiseExit" });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const flow = AsyncResult.isSuccess(result) ? result.value : null;
  if (!flow) return null;
  const current = flow.phases.find((p) => p.status === "current")?.phase;
  const autonomy = AsyncResult.isSuccess(autonomyResult)
    ? autonomyResult.value
    : null;
  const at = (phase: Phase) =>
    autonomy?.boundaries.find((b) => b.boundary === phase);

  return (
    <>
      <FlowChecklist
        steps={flow.phases.map(({ phase, status, reason }) => ({
          title: PHASE_TITLES[phase],
          status,
          reason,
        }))}
        boundaries={flow.phases
          .slice(0, -1)
          .map(({ phase }) => boundaryState(at(phase)))}
      >
        {current && !flow.checkpoint && (
          <SkipPhase
            key={current}
            phase={PHASE_TITLES[current]}
            pending={pending}
            failed={failed}
            onSkip={(reason) =>
              void (async () => {
                setPending(true);
                const exit = await skip({
                  params: { session: sessionId },
                  payload: { phase: current, reason },
                });
                setPending(false);
                setFailed(Exit.isFailure(exit));
              })()
            }
          />
        )}
      </FlowChecklist>
      {autonomy?.boundaries.flatMap(({ boundary, granted, withdrawn }) =>
        withdrawn && !granted
          ? [
              <AutonomyWithdrawn
                key={boundary}
                boundary={boundaryTitle(boundary)}
                reason={withdrawn.reason}
              />,
            ]
          : [],
      )}
    </>
  );
}
