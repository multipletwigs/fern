import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import type { ToolCallStatus } from "@repo/api";
import { clsx } from "clsx";
import type { ReactNode } from "react";
import { Expandable } from "./Expandable";
import { Loader } from "./Loader";

// A tool call, collapsed to its name and summary. A running call trails a loader; a failed one
// shows its name in red.
export function ToolCallRow({
  name,
  summary,
  status,
  onOpen,
  children,
}: {
  name: string;
  summary: string;
  status: ToolCallStatus;
  // Opens the file the call touched, e.g. in the code panel.
  onOpen?: () => void;
  children: ReactNode;
}) {
  return (
    <Expandable
      label={
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className={clsx(
              "shrink-0 font-mono text-[13px]",
              status === "failed" ? "text-danger" : "text-ink/80",
            )}
          >
            {name}
          </span>
          <span className="truncate font-mono text-[13px] text-faint">
            {summary}
          </span>
          {status === "running" && (
            <Loader className="shrink-0 text-base text-ink" />
          )}
          {onOpen && (
            // A span, not a button: it sits inside the row's own toggle button.
            <span
              role="button"
              tabIndex={0}
              title="Open in code panel"
              onClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                onOpen();
              }}
              className="shrink-0 rounded p-0.5 text-faint transition-colors hover:bg-white/[0.06] hover:text-ink"
            >
              <ArrowSquareOutIcon className="size-3.5" />
            </span>
          )}
        </span>
      }
    >
      {children}
    </Expandable>
  );
}
