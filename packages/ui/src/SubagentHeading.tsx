import type { SubagentStatus } from "@repo/api";
import { clsx } from "clsx";
import { Loader } from "./Loader";

const duration = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const compact = (tokens: number) =>
  tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1)}M`
    : tokens >= 1_000
      ? `${Math.round(tokens / 1_000)}k`
      : String(tokens);

// The top of a Subagent's tab: its type, what it was asked to do and where it stands, then how long
// it has worked, how many tools it called and how many tokens its last request used.
export function SubagentHeading({
  agentType,
  description,
  status,
  durationMs,
  toolCalls,
  tokens,
}: {
  agentType: string;
  description: string;
  status: SubagentStatus;
  durationMs: number;
  toolCalls: number;
  tokens: number;
}) {
  return (
    <div className="mt-6 flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <span
          className={clsx(
            "shrink-0 font-mono text-[13px]",
            status === "failed" ? "text-danger" : "text-ink/80",
          )}
        >
          {agentType}
        </span>
        <span className="truncate text-[15px] text-ink">{description}</span>
        {status === "running" ? (
          <Loader className="shrink-0 self-center text-base text-ink" />
        ) : (
          <span
            className={clsx(
              "shrink-0 text-xs",
              status === "failed" ? "text-danger" : "text-faint",
            )}
          >
            {status}
          </span>
        )}
      </div>
      <div className="flex gap-3 font-mono text-xs text-faint tabular-nums">
        <span>{duration(durationMs)}</span>
        <span>
          {toolCalls} tool {toolCalls === 1 ? "call" : "calls"}
        </span>
        <span>{compact(tokens)} tokens</span>
      </div>
    </div>
  );
}
