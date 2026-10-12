import { WarningCircleIcon } from "@phosphor-icons/react";

// Why Fern no longer approves a boundary itself: an Escape slipped past it after Fern approved it.
export function AutonomyWithdrawn({
  boundary,
  reason,
}: {
  boundary: string;
  reason: string;
}) {
  return (
    <p
      role="status"
      className="flex items-center gap-1.5 px-5 pb-2 text-[12px] text-amber/90"
    >
      <WarningCircleIcon weight="bold" className="size-3.5 shrink-0" />
      <span>
        Autonomy withdrawn at {boundary}:{" "}
        <span className="text-muted">{reason}.</span>
      </span>
    </p>
  );
}
