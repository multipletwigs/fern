import { RobotIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";
import { Loader } from "./Loader";

// A Subagent the agent delegated to: its type, what it was asked to do, and where it stands. A
// running one trails a loader, a finished one how it ended; a failed one shows its type in red.
// Given `onOpen`, the row is a button that opens the Subagent.
export function SubagentRow({
  agentType,
  description,
  status,
  onOpen,
}: {
  agentType: string;
  description: string;
  status: "running" | "done" | "failed" | "stopped";
  onOpen?: () => void;
}) {
  const content = (
    <>
      <RobotIcon className="size-3.5 shrink-0 text-faint" />
      <span
        className={clsx(
          "shrink-0 font-mono text-[13px]",
          status === "failed" ? "text-danger" : "text-ink/80",
        )}
      >
        {agentType}
      </span>
      <span className="truncate text-[13px] text-faint">{description}</span>
      {status === "running" ? (
        <Loader className="shrink-0 text-base text-ink" />
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
    </>
  );
  const className =
    "my-1.5 flex w-full min-w-0 items-center gap-2.5 text-left text-sm text-muted";
  return onOpen ? (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(className, "hover:text-ink")}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
