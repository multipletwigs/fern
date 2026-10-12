import { WarningCircleIcon } from "@phosphor-icons/react";
import type { ResendState } from "@repo/api";
import { GhostButton } from "./GhostButton";

// Inside a developer's message that Claude Code stopped before replying to, with a way to send it
// again. Once sent, the button stays spent so a second click doesn't send it twice.
export function UnansweredNotice({
  state,
  onResend,
}: {
  state: ResendState;
  onResend: () => void;
}) {
  return (
    <div
      role="status"
      className="mt-3 flex items-center gap-3 border-t border-amber/15 pt-3 text-[13px] leading-5 whitespace-normal"
    >
      <WarningCircleIcon
        weight="bold"
        className="size-4 shrink-0 text-amber/90"
      />
      <span className="min-w-0 flex-1 text-amber/90">
        Not answered:{" "}
        {state === "failed" ? (
          <span className="text-danger/90">couldn't send it again</span>
        ) : (
          <span className="text-muted">Claude Code stopped before replying</span>
        )}
      </span>
      <GhostButton
        disabled={state === "sending" || state === "sent"}
        onClick={onResend}
      >
        {state === "sending"
          ? "Sending…"
          : state === "sent"
            ? "Sent"
            : "Send again"}
      </GhostButton>
    </div>
  );
}
