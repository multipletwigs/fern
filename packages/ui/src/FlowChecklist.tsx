import {
  CheckCircleIcon,
  CircleDashedIcon,
  CircleIcon,
  MinusCircleIcon,
} from "@phosphor-icons/react";
import { clsx } from "clsx";
import { Fragment } from "react";
import { type BoundaryState, FlowBoundary } from "./FlowBoundary";

export type ChecklistStatus = "notStarted" | "current" | "done" | "skipped";

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
export function FlowChecklist({
  steps,
  boundaries = [],
}: {
  steps: ReadonlyArray<{ title: string; status: ChecklistStatus }>;
  boundaries?: ReadonlyArray<BoundaryState>;
}) {
  return (
    <ol
      aria-label="Flow"
      className="flex items-center gap-2 px-5 pb-2 text-[12px]"
    >
      {steps.map(({ title, status }, i) => {
        const Icon = ICONS[status];
        return (
          <Fragment key={title}>
            {i > 0 && (
              <FlowBoundary state={boundaries[i - 1] ?? { kind: "needsYou" }} />
            )}
            <li
              aria-label={`${title}: ${LABELS[status]}`}
              aria-current={status === "current" ? "step" : undefined}
              className={clsx(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1",
                status === "current" && "border-ice/30 bg-ice/[0.06] text-ice",
                status === "done" && "border-hairline text-mint/90",
                status === "skipped" &&
                  "border-hairline text-faint line-through",
                status === "notStarted" && "border-hairline text-muted",
              )}
            >
              <Icon
                weight={status === "current" ? "fill" : "regular"}
                className="size-3.5 shrink-0"
              />
              {title}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
