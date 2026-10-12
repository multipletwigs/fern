import { useAtomSet } from "@effect/atom-react";
import type { FindingVerdict as Verdict } from "@repo/api";
import { VerdictControls } from "@repo/ui/VerdictControls";
import { Exit } from "effect";
import { useState } from "react";
import { findingVerdictAtom } from "./atoms";

const LABELS = {
  approve: "Accept",
  reject: "Decline",
  approved: "Accepted",
  rejected: "Declined",
};

// The developer's verdict on one Finding, sent as they give it. Declining takes an optional note.
export function FindingVerdict({
  findingId,
  verdict,
}: {
  findingId: string;
  verdict: Verdict | undefined;
}) {
  const send = useAtomSet(findingVerdictAtom, { mode: "promiseExit" });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const decide = async (kind: Verdict["kind"], note?: string) => {
    setPending(true);
    const exit = await send({
      params: { id: findingId },
      payload: { kind, note: note || undefined },
    });
    setPending(false);
    setFailed(Exit.isFailure(exit));
  };
  return (
    <div className="space-y-2">
      <VerdictControls
        verdict={
          verdict && {
            kind: verdict.kind === "accepted" ? "approved" : "rejected",
            note: verdict.note,
          }
        }
        locked={false}
        pending={pending}
        labels={LABELS}
        noteOptional
        notePlaceholder="Why not? Optional, and kept for the next Retro."
        onApprove={() => void decide("accepted")}
        onReject={(note) => void decide("declined", note)}
      />
      {failed && (
        <p className="text-xs text-danger/80">Couldn't save that. Try again.</p>
      )}
    </div>
  );
}
