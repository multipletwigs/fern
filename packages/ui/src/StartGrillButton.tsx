import { ChatsCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";

// In the top bar of a Session still a chat: opens a field for what to Grill, and starts the Grill
// on it. Escape or clicking away closes it.
export function StartGrillButton({
  pending,
  failed,
  onStart,
}: {
  pending: boolean;
  failed: boolean;
  onStart: (what: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState("");
  const start = () => {
    if (what.trim()) onStart(what.trim());
  };
  return (
    <div className="no-drag relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted transition-colors hover:bg-side-field hover:text-ink"
      >
        <ChatsCircleIcon className="size-4" />
        Start a Grill
      </button>
      {open && (
        <div
          className="absolute top-9 right-0 z-30 w-[360px] rounded-xl border border-white/10 bg-[#111] p-3 shadow-[0_16px_50px_rgb(0_0_0/0.6)]"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              setOpen(false);
          }}
        >
          <input
            // Opened by the developer's own click, so focus follows it.
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={what}
            onChange={(event) => setWhat(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") start();
              if (event.key === "Escape") setOpen(false);
            }}
            placeholder="What should the Grill be about?"
            className="h-9 w-full rounded-lg border border-hairline bg-white/[0.02] px-3 text-[14px] text-ink outline-none placeholder:text-faint focus:border-amber/30"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[12px] text-faint">
              Starts the Flow after the chat so far
            </span>
            <button
              type="button"
              disabled={pending || !what.trim()}
              onClick={start}
              className="h-8 rounded-lg border border-hairline px-3 text-[13px] text-ice/90 transition-colors hover:border-ice/30 hover:bg-ice/[0.06] disabled:pointer-events-none disabled:opacity-40"
            >
              Start Grill
            </button>
          </div>
          {failed && (
            <p className="mt-2 text-xs text-danger/80">
              Couldn't start the Grill. Try again once Claude is done.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
