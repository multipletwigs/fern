import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { CheckpointWalkthrough as Linked } from "@repo/api";
import { WalkthroughRow } from "@repo/ui/WalkthroughRow";
import { AsyncResult } from "effect/reactivity";
import { openAtom } from "../code/atoms";
import { walkthroughsAtom } from "../walkthrough/atoms";
import { rowStatus } from "../walkthrough/review";

// The Session's Walkthrough on the Implement Checkpoint, opening it in the code panel.
export function CheckpointWalkthrough({
  sessionId,
  walkthrough,
}: {
  sessionId: string;
  walkthrough: Linked;
}) {
  const result = useAtomValue(walkthroughsAtom(sessionId));
  const open = useAtomSet(openAtom(sessionId));
  const found = AsyncResult.isSuccess(result)
    ? result.value.find((w) => w.id === walkthrough.id)
    : undefined;
  return (
    <section
      aria-label="Walkthrough"
      className="mt-3 rounded-xl border border-hairline bg-white/[0.02] p-1.5"
    >
      <p className="px-2.5 pt-1 pb-1 font-mono text-[10px] tracking-wide text-faint uppercase">
        Walkthrough
      </p>
      <WalkthroughRow
        number={walkthrough.number}
        {...(found ? rowStatus(found) : { status: "", tone: "muted" })}
        active={false}
        onSelect={() => open({ kind: "walkthrough", id: walkthrough.id })}
      />
    </section>
  );
}
