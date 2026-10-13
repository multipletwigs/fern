import { useAtomSet } from "@effect/atom-react";
import type { Checkpoint, Land } from "@repo/api";
import { LandCard } from "@repo/ui/LandCard";
import { Exit } from "effect";
import { useState } from "react";
import { approveCheckpointAtom, sendCheckpointAtom } from "./atoms";
import { landControls } from "./landControls";

// The Session's Land Checkpoint, above its composer: landing the Stack, and after GitHub refused,
// sending its reason to the agent or trying again.
export function LandCheckpoint({
  checkpoint,
  land,
}: {
  checkpoint: Checkpoint;
  land: Land;
}) {
  const approve = useAtomSet(approveCheckpointAtom, { mode: "promiseExit" });
  const send = useAtomSet(sendCheckpointAtom, { mode: "promiseExit" });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const controls = landControls(land);

  const act = async (run: () => Promise<Exit.Exit<unknown, unknown>>) => {
    setPending(true);
    const exit = await run();
    setPending(false);
    setFailed(Exit.isFailure(exit));
  };
  return (
    <LandCard
      {...controls}
      summary={checkpoint.summary}
      prs={land.prs}
      url={land.url}
      waiting={land.waiting}
      refusal={land.refusal}
      refusalSent={land.refusalSentAt !== undefined}
      landing={land.landing}
      pending={pending}
      failed={failed}
      onLand={() => void act(() => approve({ params: { id: checkpoint.id } }))}
      onSend={() => void act(() => send({ params: { id: checkpoint.id } }))}
    />
  );
}
