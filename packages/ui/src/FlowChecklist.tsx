import { Tooltip } from "@base-ui/react/tooltip";
import type { PhaseStatus } from "@repo/api";
import {
  CheckCircleIcon,
  CircleDashedIcon,
  CircleIcon,
  MinusCircleIcon,
} from "@phosphor-icons/react";
import { clsx } from "clsx";
import { Fragment, type ReactNode } from "react";
import { type BoundaryState, FlowBoundary } from "./FlowBoundary";
import { TooltipPanel } from "./TooltipPanel";

const ICONS = {
  notStarted: CircleDashedIcon,
  current: CircleIcon,
  done: CheckCircleIcon,
  skipped: MinusCircleIcon,
} as const;

const LABELS = {
  notStarted: "not started",
  current: "current",
  done: "done",
  skipped: "skipped",
} as const;

// A Session's Phases in order, pinned at the top of the Session: each not started, current, done
// or skipped. Between each two, the boundary: locked while it needs the developer, checked once
// Fern approves it. `boundaries[i]` is the one after step i; missing ones need the developer.
// Resting the pointer on a skipped Phase shows why it was skipped. `children` go at the end of
// the row.
export function FlowChecklist({
  steps,
  boundaries = [],
  children,
}: {
  steps: ReadonlyArray<{
    title: string;
    status: PhaseStatus;
    reason?: string | undefined;
  }>;
  boundaries?: ReadonlyArray<BoundaryState>;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-5 pb-2 text-[12px]">
      <ol aria-label="Flow" className="flex items-center gap-2">
        {steps.map(({ title, status, reason }, i) => {
          const Icon = ICONS[status];
          const step = {
            "aria-label": reason
              ? `${title}: ${LABELS[status]}, ${reason}`
              : `${title}: ${LABELS[status]}`,
            "aria-current":
              status === "current" ? ("step" as const) : undefined,
            className: clsx(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1",
              status === "current" && "border-ice/30 bg-ice/[0.06] text-ice",
              status === "done" && "border-hairline text-mint/90",
              status === "skipped" && "border-hairline text-faint line-through",
              status === "notStarted" && "border-hairline text-muted",
            ),
          };
          const content = (
            <>
              <Icon
                weight={status === "current" ? "fill" : "regular"}
                className="size-3.5 shrink-0"
              />
              {title}
            </>
          );
          return (
            <Fragment key={title}>
              {i > 0 && (
                <FlowBoundary
                  state={boundaries[i - 1] ?? { kind: "needsYou" }}
                />
              )}
              {reason ? (
                <Tooltip.Root>
                  <Tooltip.Trigger delay={150} render={<li {...step} />}>
                    {content}
                  </Tooltip.Trigger>
                  <TooltipPanel>
                    <p className="max-w-72 px-1.5 py-0.5 text-[12px] leading-5 text-ink">
                      <span className="text-muted">Skipped: </span>
                      {reason}
                    </p>
                  </TooltipPanel>
                </Tooltip.Root>
              ) : (
                <li {...step}>{content}</li>
              )}
            </Fragment>
          );
        })}
      </ol>
      {children}
    </div>
  );
}
