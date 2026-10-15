import { ChatsCircleIcon } from "@phosphor-icons/react";
import type { GrillSuggestionStatus } from "@repo/api";
import { useState } from "react";
import { GhostButton } from "./GhostButton";

// Where Claude suggested the chat become a Grill: the work in a line, which the developer can edit
// before starting the Grill on it, or turn down for now. Once decided, or once the Session's Flow
// started some other way, it stays as a line saying so.
export function GrillSuggestionCard({
  what,
  status,
  flowStarted,
  pending,
  failed,
  onStart,
  onDismiss,
}: {
  what: string;
  status: GrillSuggestionStatus;
  flowStarted: boolean;
  pending: boolean;
  failed: boolean;
  onStart: (what: string) => void;
  onDismiss: () => void;
}) {
  const [draft, setDraft] = useState(what);
  if (status !== "pending" || flowStarted)
    return (
      <p className="my-3 flex min-w-0 items-center gap-2 text-[13px] text-muted">
        <ChatsCircleIcon className="size-3.5 shrink-0 text-faint" />
        <span className="shrink-0 text-faint">
          {status === "dismissed" ? "Not now" : "Grill started"}
        </span>
        <span className="truncate">{what}</span>
      </p>
    );
  const start = () => {
    if (draft.trim()) onStart(draft.trim());
  };
  return (
    <section
      aria-label="Grill suggestion"
      className="my-3 rounded-2xl border border-amber/20 bg-amber/[0.03] p-4"
    >
      <p className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-amber/80 uppercase">
        <ChatsCircleIcon weight="bold" className="size-3" />
        Grill suggestion
      </p>
      <h3 className="mt-1.5 text-[15px] leading-6 text-ink">
        Feels like you should grill this
      </h3>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") start();
        }}
        aria-label="What the Grill is about"
        className="mt-3 h-9 w-full rounded-lg border border-hairline bg-white/[0.02] px-3 text-[14px] text-ink outline-none placeholder:text-faint focus:border-amber/30"
      />
      <div className="mt-3 flex gap-2">
        <GhostButton
          tone="ice"
          disabled={pending || !draft.trim()}
          onClick={start}
        >
          Start Grill
        </GhostButton>
        <GhostButton disabled={pending} onClick={onDismiss}>
          Not now
        </GhostButton>
      </div>
      {failed && (
        <p className="mt-2 text-xs text-danger/80">
          Couldn't start the Grill. Try again once Claude is done.
        </p>
      )}
    </section>
  );
}
