import {
  CheckIcon,
  PaperPlaneTiltIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { Risk } from "@repo/api";
import { clsx } from "clsx";
import { RiskBadge } from "./RiskBadge";

// How an entry was settled, or why it can't be yet, when a check or an empty ring says too little:
// approved or rejected, or a Walkthrough still being written or that failed.
export type ReviewMark = "approved" | "rejected" | "writing" | "failed";

// One item in a review layout's list: a check once it's settled, else an empty ring, then its
// number and what it is, with how it was settled beneath. A `step`, such as sending a Round's
// answers, is something to do rather than settle, and is marked with a paper plane, lit once it's
// `settled`, meaning ready. A `mark` takes the place of the check or ring. A Section's `risk` shows
// beside its title. In a narrow layout only the mark shows.
export function ReviewEntry({
  number,
  title,
  detail,
  settled,
  step = false,
  mark,
  risk,
}: {
  number?: number;
  title: string;
  detail?: string;
  settled: boolean;
  step?: boolean;
  mark?: ReviewMark;
  risk?: Risk;
}) {
  return (
    <span className="flex w-full min-w-0 items-start gap-2.5 @max-3xl:justify-center">
      <span
        className={clsx(
          "mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full transition-colors",
          mark === "approved" && "bg-mint/[0.12] text-mint",
          mark === "rejected" && "bg-danger/[0.12] text-danger",
          mark === "writing" &&
            "border border-dashed border-white/[0.24] motion-safe:animate-spin motion-safe:[animation-duration:3s]",
          mark === "failed" && "text-danger/80",
          mark === undefined &&
            (step
              ? settled
                ? "bg-ice/[0.14] text-ice"
                : "text-faint"
              : settled
                ? "bg-mint/[0.12] text-mint"
                : "border border-white/[0.16]"),
        )}
      >
        {mark === "approved" ? (
          <CheckIcon weight="bold" className="size-2.5" />
        ) : mark === "rejected" ? (
          <XIcon weight="bold" className="size-2.5" />
        ) : mark === "failed" ? (
          <WarningIcon weight="fill" className="size-3.5" />
        ) : mark === "writing" ? null : step ? (
          <PaperPlaneTiltIcon weight="fill" className="size-3" />
        ) : (
          settled && <CheckIcon weight="bold" className="size-2.5" />
        )}
      </span>
      <span className="min-w-0 flex-1 @max-3xl:sr-only">
        <span className="flex gap-2 leading-5">
          {number !== undefined && (
            <span className="shrink-0 font-mono text-[11px] leading-5 text-faint tabular-nums">
              {number}
            </span>
          )}
          <span className="line-clamp-2 min-w-0 flex-1">{title}</span>
          {risk && (
            <span className="mt-px shrink-0">
              <RiskBadge level={risk.level} reason={risk.reason} compact />
            </span>
          )}
        </span>
        {detail && (
          <span
            className={clsx(
              "mt-0.5 block truncate text-[12px]",
              mark === "rejected" ? "text-danger/70" : "text-muted",
            )}
          >
            {detail}
          </span>
        )}
      </span>
    </span>
  );
}
