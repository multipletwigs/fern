import type { VerdictKind } from "@repo/api";
import { clsx } from "clsx";
import { KeyHint } from "./KeyHint";

const button =
  "flex h-9 items-center gap-2 rounded-xl border px-3.5 text-[13px] font-medium transition-[background-color,border-color,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40";

// The verdict on the item open in the Review tab, at the foot of its pane: Approve and Reject with
// their keys, or the verdict given, which can change until the Walkthrough is Reviewed. Rejecting
// opens a field for the note, which a Rejection can't go without; the parent holds it, so a key
// can open it too.
export function VerdictBar({
  verdict,
  locked,
  pending,
  failed,
  noting,
  note,
  onNote,
  onApprove,
  onNoting,
  onReject,
}: {
  verdict: { kind: VerdictKind; note?: string | undefined } | undefined;
  // The review is done; verdicts can no longer change.
  locked: boolean;
  pending: boolean;
  // The last verdict didn't save.
  failed: boolean;
  // The note field is open.
  noting: boolean;
  note: string;
  onNote: (note: string) => void;
  onApprove: () => void;
  // Opens or closes the note field.
  onNoting: (noting: boolean) => void;
  onReject: () => void;
}) {
  const noted = note.trim() !== "";
  return (
    <div className="space-y-3">
      {noting ? (
        <div className="space-y-2">
          <textarea
            // Opened by the developer's own key or click, so focus follows it.
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={note}
            onChange={(event) => onNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                if (noted) onReject();
              }
              if (event.key === "Escape") {
                // Let go first, so focus goes back to the review layout and its keys.
                event.currentTarget.blur();
                onNoting(false);
              }
            }}
            placeholder="What should change? This goes back to the Session."
            rows={3}
            className="w-full resize-none rounded-xl border border-hairline bg-white/[0.02] px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus:border-danger/30"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!noted || pending}
              onClick={onReject}
              className={clsx(
                button,
                "border-danger/25 text-danger/90 hover:bg-danger/[0.06]",
              )}
            >
              Reject
              <span className="font-mono text-[11px] opacity-60">⌘↵</span>
            </button>
            <button
              type="button"
              onClick={() => onNoting(false)}
              className={clsx(
                button,
                "border-hairline text-ink/70 hover:bg-white/[0.05]",
              )}
            >
              Cancel
              <span className="font-mono text-[11px] opacity-60">esc</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {verdict && (
            <p className="mr-2 flex min-w-0 flex-1 items-baseline gap-2.5 text-[13px]">
              <span
                className={clsx(
                  "shrink-0 font-medium",
                  verdict.kind === "approved" ? "text-mint" : "text-danger/90",
                )}
              >
                {verdict.kind === "approved" ? "Approved" : "Rejected"}
              </span>
              {verdict.note && (
                <span className="min-w-0 text-muted">“{verdict.note}”</span>
              )}
            </p>
          )}
          {!locked && (
            <>
              <button
                type="button"
                disabled={pending || verdict?.kind === "approved"}
                onClick={onApprove}
                className={clsx(
                  button,
                  "border-ice/25 bg-ice/[0.06] text-ice hover:bg-ice/[0.1]",
                )}
              >
                Approve
                <KeyHint>a</KeyHint>
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => onNoting(true)}
                className={clsx(
                  button,
                  "border-danger/20 text-danger/90 hover:bg-danger/[0.06]",
                )}
              >
                {verdict?.kind === "rejected" ? "Change note" : "Reject"}
                <KeyHint>r</KeyHint>
              </button>
              <span className="ml-auto flex items-center gap-1.5 text-[12px] text-faint">
                <KeyHint>j</KeyHint>
                <KeyHint>k</KeyHint> move
              </span>
            </>
          )}
        </div>
      )}
      {failed && (
        <p className="text-xs text-danger/80">
          Couldn't save that verdict. Try again.
        </p>
      )}
    </div>
  );
}
