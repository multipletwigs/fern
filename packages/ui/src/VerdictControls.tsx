import { useState } from "react";
import { GhostButton } from "./GhostButton";

// What the two verdicts are called, as buttons and once given.
export interface VerdictLabels {
  readonly approve: string;
  readonly reject: string;
  readonly approved: string;
  readonly rejected: string;
}

const REVIEW_LABELS: VerdictLabels = {
  approve: "Approve",
  reject: "Reject",
  approved: "Approved",
  rejected: "Rejected",
};

// Approve or reject one item under review. Rejecting asks for a note, which goes back to the
// Session. A verdict can be changed until the review is done.
export function VerdictControls({
  verdict,
  locked,
  pending,
  onApprove,
  onReject,
  labels = REVIEW_LABELS,
  noteOptional = false,
  notePlaceholder = "What should change? This goes back to the Session.",
}: {
  verdict:
    { kind: "approved" | "rejected"; note?: string | undefined } | undefined;
  // The review is done; verdicts can no longer change.
  locked: boolean;
  pending: boolean;
  onApprove: () => void;
  onReject: (note: string) => void;
  labels?: VerdictLabels;
  // Rejecting can go without a note.
  noteOptional?: boolean;
  notePlaceholder?: string;
}) {
  const [mode, setMode] = useState<"idle" | "noting" | "changing">("idle");
  const [note, setNote] = useState("");
  const noted = noteOptional || note.trim() !== "";
  const reject = () => {
    if (!noted) return;
    onReject(note.trim());
    setMode("idle");
  };

  if (mode === "noting")
    return (
      <div className="space-y-2">
        <textarea
          // Opened by the developer's own click, so focus follows it.
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
              reject();
            if (event.key === "Escape") setMode("idle");
          }}
          placeholder={notePlaceholder}
          rows={3}
          className="w-full resize-none rounded-xl border border-hairline bg-white/[0.02] px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus:border-danger/30"
        />
        <div className="flex gap-2">
          <GhostButton
            tone="danger"
            disabled={!noted || pending}
            onClick={reject}
          >
            {labels.reject}
          </GhostButton>
          <GhostButton onClick={() => setMode("idle")}>Cancel</GhostButton>
        </div>
      </div>
    );

  if (verdict && mode !== "changing")
    return (
      <div className="flex items-start gap-3 text-[13px]">
        <span
          className={
            verdict.kind === "approved"
              ? "shrink-0 text-ice/90"
              : "shrink-0 text-danger/90"
          }
        >
          {verdict.kind === "approved" ? labels.approved : labels.rejected}
        </span>
        {verdict.note && (
          <span className="min-w-0 flex-1 text-muted">“{verdict.note}”</span>
        )}
        {!locked && (
          <button
            type="button"
            onClick={() => {
              setNote(verdict.note ?? "");
              setMode("changing");
            }}
            className="ml-auto shrink-0 text-faint transition-colors hover:text-ink"
          >
            Change
          </button>
        )}
      </div>
    );

  return (
    <div className="flex gap-2">
      <GhostButton
        tone="ice"
        disabled={pending}
        onClick={() => {
          onApprove();
          setMode("idle");
        }}
      >
        {labels.approve}
      </GhostButton>
      <GhostButton
        tone="danger"
        disabled={pending}
        onClick={() => setMode("noting")}
      >
        {labels.reject}…
      </GhostButton>
    </div>
  );
}
