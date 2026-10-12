import { LockSimpleIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { GhostButton } from "./GhostButton";

// A Session waiting on the developer at the end of a Phase: what the agent says it did, and the
// question to settle. Approving moves the Flow on; declining asks for a note, which goes back to
// the Session. `children` shows what the Phase produced, under the summary.
export function CheckpointCard({
  eyebrow,
  question,
  summary,
  pending,
  failed,
  onApprove,
  onDecline,
  children,
}: {
  eyebrow: string;
  question: string;
  summary: string;
  pending: boolean;
  failed: boolean;
  onApprove: () => void;
  onDecline: (note: string) => void;
  children?: ReactNode;
}) {
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const decline = () => {
    if (!note.trim()) return;
    onDecline(note.trim());
    setNoting(false);
    setNote("");
  };

  return (
    <section
      aria-label="Checkpoint"
      className="mb-3 rounded-2xl border border-ice/20 bg-ice/[0.03] p-4"
    >
      <p className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-ice/80 uppercase">
        <LockSimpleIcon weight="bold" className="size-3" />
        {eyebrow}
      </p>
      <h3 className="mt-1.5 text-[15px] leading-6 text-ink">{question}</h3>
      <p className="mt-2 text-[13px] leading-5 whitespace-pre-wrap text-muted">
        {summary}
      </p>
      {children}
      <div className="mt-4">
        {noting ? (
          <div className="space-y-2">
            <textarea
              // Opened by the developer's own click, so focus follows it.
              // oxlint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
                  decline();
                if (event.key === "Escape") setNoting(false);
              }}
              placeholder="What isn't done yet? This goes back to the Session."
              rows={3}
              className="w-full resize-none rounded-xl border border-hairline bg-white/[0.02] px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus:border-danger/30"
            />
            <div className="flex gap-2">
              <GhostButton
                tone="danger"
                disabled={!note.trim() || pending}
                onClick={decline}
              >
                Decline
              </GhostButton>
              <GhostButton onClick={() => setNoting(false)}>Cancel</GhostButton>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <GhostButton tone="ice" disabled={pending} onClick={onApprove}>
              Approve
            </GhostButton>
            <GhostButton
              tone="danger"
              disabled={pending}
              onClick={() => setNoting(true)}
            >
              Decline…
            </GhostButton>
          </div>
        )}
        {failed && (
          <p className="mt-2 text-xs text-danger/80">
            Couldn't send that. Try again.
          </p>
        )}
      </div>
    </section>
  );
}
