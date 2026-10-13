import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { CheckpointCard } from "@repo/ui/CheckpointCard";
import { LandWaitingCard } from "@repo/ui/LandWaitingCard";
import { SpecIssues } from "@repo/ui/SpecIssues";
import { Exit } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import {
  approveCheckpointAtom,
  declineCheckpointAtom,
  flowAtom,
} from "./atoms";
import { CheckpointWalkthrough } from "./CheckpointWalkthrough";
import { LandCheckpoint } from "./LandCheckpoint";
import { CHECKPOINT_QUESTIONS, PHASE_TITLES } from "./phases";
import { RetroFindings } from "./RetroFindings";

// The Checkpoint the Session is waiting at, if any, above its composer; before its Land
// Checkpoint opens, what the Stack still waits on.
export function SessionCheckpoint({ sessionId }: { sessionId: string }) {
  const result = useAtomValue(flowAtom(sessionId));
  const approve = useAtomSet(approveCheckpointAtom, { mode: "promiseExit" });
  const decline = useAtomSet(declineCheckpointAtom, { mode: "promiseExit" });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const flow = AsyncResult.isSuccess(result) ? result.value : null;
  const checkpoint = flow?.checkpoint;
  if (!checkpoint)
    return flow?.landWaitsOn ? (
      <LandWaitingCard waiting={flow.landWaitsOn} />
    ) : null;
  if (checkpoint.land)
    return (
      <LandCheckpoint
        key={checkpoint.id}
        checkpoint={checkpoint}
        land={checkpoint.land}
      />
    );
  if (checkpoint.findings)
    return (
      <RetroFindings
        key={checkpoint.id}
        checkpoint={checkpoint}
        findings={checkpoint.findings}
      />
    );

  const decide = async (run: () => Promise<Exit.Exit<unknown, unknown>>) => {
    setPending(true);
    const exit = await run();
    setPending(false);
    setFailed(Exit.isFailure(exit));
  };
  return (
    <CheckpointCard
      key={checkpoint.id}
      eyebrow={`End of ${PHASE_TITLES[checkpoint.phase]}`}
      question={CHECKPOINT_QUESTIONS[checkpoint.phase]}
      summary={checkpoint.summary}
      pending={pending}
      failed={failed}
      onApprove={() =>
        void decide(() => approve({ params: { id: checkpoint.id } }))
      }
      onDecline={(note) =>
        void decide(() =>
          decline({ params: { id: checkpoint.id }, payload: { note } }),
        )
      }
    >
      {checkpoint.spec && (
        <SpecIssues
          brief={checkpoint.spec.brief}
          tickets={checkpoint.spec.tickets}
        />
      )}
      {checkpoint.walkthrough && (
        <CheckpointWalkthrough
          sessionId={sessionId}
          walkthrough={checkpoint.walkthrough}
        />
      )}
    </CheckpointCard>
  );
}
