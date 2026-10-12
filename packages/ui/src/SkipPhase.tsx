import { useState } from "react";

// Skips the current Phase: a quiet button that opens a one-line field for the reason, which the
// Skip can't go without.
export function SkipPhase({
  phase,
  pending,
  failed,
  onSkip,
}: {
  phase: string;
  pending: boolean;
  failed: boolean;
  onSkip: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const skip = () => {
    if (!reason.trim() || pending) return;
    onSkip(reason.trim());
    setOpen(false);
    setReason("");
  };

  if (!open)
    return (
      <div className="ml-auto flex items-center gap-2">
        {failed && (
          <span className="text-xs text-danger/80">
            Couldn't skip. Try again.
          </span>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => setOpen(true)}
          className="rounded-md px-2 py-1 text-muted transition-colors hover:bg-white/[0.05] hover:text-ink disabled:opacity-40"
        >
          Skip {phase}…
        </button>
      </div>
    );
  return (
    <form
      aria-label={`Skip ${phase}`}
      className="ml-auto flex items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        skip();
      }}
    >
      <input
        // Opened by the developer's own click, so focus follows it.
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        aria-label="Why skip it?"
        placeholder={`Why skip ${phase}?`}
        className="h-7 w-64 rounded-md border border-hairline bg-white/[0.02] px-2 text-[12px] text-ink outline-none placeholder:text-faint focus:border-ice/30"
      />
      <button
        type="submit"
        disabled={!reason.trim() || pending}
        className="h-7 rounded-md border border-hairline px-2.5 text-ice/90 transition-colors hover:border-ice/30 hover:bg-ice/[0.06] disabled:pointer-events-none disabled:opacity-40"
      >
        Skip
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="h-7 rounded-md px-2 text-muted transition-colors hover:bg-white/[0.05] hover:text-ink"
      >
        Cancel
      </button>
    </form>
  );
}
