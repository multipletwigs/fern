import { useAtomSet } from "@effect/atom-react";
import type { Verdict, VerdictKind } from "@repo/api";
import { VerdictControls } from "@repo/ui/VerdictControls";
import { Exit } from "effect";
import { useState } from "react";
import { verdictAtom } from "./atoms";

// The verdict on one Section or Unexplained change, sent as the developer gives it.
export function ItemVerdict({
  walkthroughId,
  item,
  verdict,
  locked,
}: {
  walkthroughId: string;
  item: string;
  verdict: Verdict | undefined;
  locked: boolean;
}) {
  const send = useAtomSet(verdictAtom, { mode: "promiseExit" });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const decide = async (kind: VerdictKind, note?: string) => {
    setPending(true);
    const exit = await send({
      params: { id: walkthroughId, item },
      payload: { kind, note },
    });
    setPending(false);
    setFailed(Exit.isFailure(exit));
  };
  return (
    <div className="space-y-2">
      <VerdictControls
        verdict={verdict}
        locked={locked}
        pending={pending}
        onApprove={() => void decide("approved")}
        onReject={(note) => void decide("rejected", note)}
      />
      {failed && (
        <p className="text-xs text-danger/80">Couldn't save that. Try again.</p>
      )}
    </div>
  );
}
