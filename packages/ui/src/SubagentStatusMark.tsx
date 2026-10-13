import { CheckIcon, StopIcon, XIcon } from "@phosphor-icons/react";
import type { SubagentStatus } from "@repo/api";

// How a Subagent stands, as one small mark: a quiet pulsing dot while it runs, then a check, a red
// cross or a stop for how it ended.
export function SubagentStatusMark({ status }: { status: SubagentStatus }) {
  if (status === "running")
    return (
      <span
        aria-label="running"
        className="size-1 shrink-0 rounded-full bg-ink/60 motion-safe:animate-pulse"
      />
    );
  if (status === "done")
    return (
      <CheckIcon aria-label="done" className="size-3 shrink-0 opacity-60" />
    );
  if (status === "failed")
    return (
      <XIcon aria-label="failed" className="size-3 shrink-0 text-danger/80" />
    );
  return (
    <StopIcon aria-label="stopped" className="size-3 shrink-0 opacity-60" />
  );
}
