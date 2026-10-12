import { SealCheckIcon } from "@phosphor-icons/react";
import { GhostButton } from "./GhostButton";

// A Milestone reached: the developer accepts or declines the Autonomy it offers.
export function MilestoneCard({
  title,
  offer,
  pending,
  failed,
  onAccept,
  onDecline,
}: {
  title: string;
  offer: string;
  pending: boolean;
  failed: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <section
      aria-label="Milestone"
      className="mb-3 rounded-2xl border border-mint/20 bg-mint/[0.03] p-4"
    >
      <p className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-mint/80 uppercase">
        <SealCheckIcon weight="bold" className="size-3" />
        Milestone
      </p>
      <h3 className="mt-1.5 text-[15px] leading-6 text-ink">{title}</h3>
      <p className="mt-2 text-[13px] leading-5 text-muted">{offer}</p>
      <div className="mt-4 flex gap-2">
        <GhostButton tone="ice" disabled={pending} onClick={onAccept}>
          Accept
        </GhostButton>
        <GhostButton disabled={pending} onClick={onDecline}>
          Decline
        </GhostButton>
      </div>
      {failed && (
        <p className="mt-2 text-xs text-danger/80">
          Couldn't send that. Try again.
        </p>
      )}
    </section>
  );
}
