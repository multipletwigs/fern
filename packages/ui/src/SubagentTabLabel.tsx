import { CheckIcon, StopIcon, XIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";

// A Subagent's tab: what it was asked to do, trailing a quiet dot while it runs, then a small mark
// for how it ended. A failed one is tinted red.
export function SubagentTabLabel({
  description,
  status,
}: {
  description: string;
  status: "running" | "done" | "failed" | "stopped";
}) {
  return (
    <>
      <span
        className={clsx(
          "max-w-[9rem] truncate",
          status === "failed" && "text-danger/80",
        )}
      >
        {description}
      </span>
      {status === "running" && (
        <span
          aria-label="running"
          className="size-1 shrink-0 rounded-full bg-ink/60 motion-safe:animate-pulse"
        />
      )}
      {status === "done" && (
        <CheckIcon aria-label="done" className="size-3 shrink-0 opacity-60" />
      )}
      {status === "failed" && (
        <XIcon aria-label="failed" className="size-3 shrink-0 text-danger/80" />
      )}
      {status === "stopped" && (
        <StopIcon aria-label="stopped" className="size-3 shrink-0 opacity-60" />
      )}
    </>
  );
}
