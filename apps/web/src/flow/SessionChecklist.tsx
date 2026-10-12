import { useAtomValue } from "@effect/atom-react";
import type { BoundaryAutonomy, Phase } from "@repo/api";
import type { BoundaryState } from "@repo/ui/FlowBoundary";
import { FlowChecklist } from "@repo/ui/FlowChecklist";
import { AsyncResult } from "effect/reactivity";
import { autonomyAtom } from "../autonomy/atoms";
import { flowAtom } from "./atoms";
import { PHASE_TITLES } from "./phases";

// Who passes the boundary at the end of a Phase: the developer, with the streak where Autonomy
// can be earned, or Fern.
const boundaryState = (at: BoundaryAutonomy | undefined): BoundaryState =>
  at === undefined
    ? { kind: "needsYou" }
    : at.approvedByFern
      ? { kind: "approvedByFern" }
      : at.granted
        ? { kind: "byFern" }
        : {
            kind: "needsYou",
            streak: { count: at.streak, threshold: at.threshold },
          };

// The Session's Flow, pinned at the top of the Session; nothing for a Session outside the Flow.
export function SessionChecklist({ sessionId }: { sessionId: string }) {
  const result = useAtomValue(flowAtom(sessionId));
  const autonomyResult = useAtomValue(autonomyAtom(sessionId));
  const flow = AsyncResult.isSuccess(result) ? result.value : null;
  if (!flow) return null;
  const autonomy = AsyncResult.isSuccess(autonomyResult)
    ? autonomyResult.value
    : null;
  const at = (phase: Phase) =>
    autonomy?.boundaries.find((b) => b.boundary === phase);
  return (
    <FlowChecklist
      steps={flow.phases.map(({ phase, status }) => ({
        title: PHASE_TITLES[phase],
        status,
      }))}
      boundaries={flow.phases
        .slice(0, -1)
        .map(({ phase }) => boundaryState(at(phase)))}
    />
  );
}
