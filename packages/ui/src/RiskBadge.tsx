import { Tooltip } from "@base-ui/react/tooltip";
import type { RiskLevel } from "@repo/api";
import { clsx } from "clsx";
import { TooltipPanel } from "./TooltipPanel";

const LABELS: Record<RiskLevel, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
};

const SHORT: Record<RiskLevel, string> = {
  low: "Low",
  medium: "Med",
  high: "High",
};

// How closely to read a Section: low, medium or high, with the Fork's reason on hover. `compact`
// fits it into a list entry.
export function RiskBadge({
  level,
  reason,
  compact = false,
}: {
  level: RiskLevel;
  reason: string;
  compact?: boolean;
}) {
  const badge = (
    <span
      aria-label={`${LABELS[level]}${reason ? `: ${reason}` : ""}`}
      className={clsx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full font-mono tracking-wide uppercase",
        compact ? "h-[18px] px-1.5 text-[9.5px]" : "h-6 px-2.5 text-[10.5px]",
        level === "low" && "bg-white/[0.05] text-muted",
        level === "medium" && "bg-ice/[0.1] text-ice",
        level === "high" && "bg-danger/[0.12] text-danger",
      )}
    >
      {!compact && (
        <span
          aria-hidden
          className={clsx(
            "size-1.5 rounded-full",
            level === "low" && "bg-muted",
            level === "medium" && "bg-ice",
            level === "high" && "bg-danger",
          )}
        />
      )}
      {compact ? SHORT[level] : LABELS[level]}
    </span>
  );
  if (!reason) return badge;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger delay={150} render={badge} />
      <TooltipPanel>
        <p className="max-w-72 px-1.5 py-0.5 text-[12px] leading-5 text-ink">
          {reason}
        </p>
      </TooltipPanel>
    </Tooltip.Root>
  );
}
