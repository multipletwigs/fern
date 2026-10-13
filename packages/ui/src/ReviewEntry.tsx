import { CheckIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";

// One item in a review layout's list: a check once it's settled, else an empty ring, then its
// number and what it is, with how it was settled beneath. A `step`, such as sending a Round's
// answers, is something to do rather than settle, and is marked with a paper plane, lit once it's
// `settled`, meaning ready. In a narrow layout only the mark shows.
export function ReviewEntry({
  number,
  title,
  detail,
  settled,
  step = false,
}: {
  number?: number;
  title: string;
  detail?: string;
  settled: boolean;
  step?: boolean;
}) {
  return (
    <span className="flex w-full min-w-0 items-start gap-2.5 @max-3xl:justify-center">
      <span
        className={clsx(
          "mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full transition-colors",
          step
            ? settled
              ? "bg-ice/[0.14] text-ice"
              : "text-faint"
            : settled
              ? "bg-mint/[0.12] text-mint"
              : "border border-white/[0.16]",
        )}
      >
        {step ? (
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
          <span className="line-clamp-2 min-w-0">{title}</span>
        </span>
        {detail && (
          <span className="mt-0.5 block truncate text-[12px] text-muted">
            {detail}
          </span>
        )}
      </span>
    </span>
  );
}
