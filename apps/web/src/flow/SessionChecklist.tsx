import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { FlowChecklist } from "@repo/ui/FlowChecklist";
import { SkipPhase } from "@repo/ui/SkipPhase";
import { Exit } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { flowAtom, skipPhaseAtom } from "./atoms";
import { PHASE_TITLES } from "./phases";

// The Session's Flow, pinned at the top of the Session; nothing for a Session outside the Flow.
// The current Phase can be skipped with a reason, unless it's waiting at a Checkpoint.
export function SessionChecklist({ sessionId }: { sessionId: string }) {
  const result = useAtomValue(flowAtom(sessionId));
  const skip = useAtomSet(skipPhaseAtom, { mode: "promiseExit" });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const flow = AsyncResult.isSuccess(result) ? result.value : null;
  if (!flow) return null;
  const current = flow.phases.find((p) => p.status === "current")?.phase;

  return (
    <FlowChecklist
      steps={flow.phases.map(({ phase, status, reason }) => ({
        title: PHASE_TITLES[phase],
        status,
        reason,
      }))}
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
  );
}
