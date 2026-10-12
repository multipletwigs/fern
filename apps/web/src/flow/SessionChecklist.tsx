import { useAtomValue } from "@effect/atom-react";
import { FlowChecklist } from "@repo/ui/FlowChecklist";
import { AsyncResult } from "effect/reactivity";
import { flowAtom } from "./atoms";
import { PHASE_TITLES } from "./phases";

// The Session's Flow, pinned at the top of the Session; nothing for a Session outside the Flow.
export function SessionChecklist({ sessionId }: { sessionId: string }) {
  const result = useAtomValue(flowAtom(sessionId));
  const flow = AsyncResult.isSuccess(result) ? result.value : null;
  if (!flow) return null;
  return (
    <FlowChecklist
      steps={flow.phases.map(({ phase, status }) => ({
        title: PHASE_TITLES[phase],
        status,
      }))}
    />
  );
}
