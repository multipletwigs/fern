import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

// Across the bottom of a Session's terminal once its shell has exited: how it exited, and a button
// that starts a fresh shell. The button takes focus, so Enter starts one.
export function TerminalExited({
  code,
  onRestart,
}: {
  code: number;
  onRestart: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  return (
    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t border-hairline bg-panel/95 px-3 py-2 text-[12.5px] backdrop-blur-sm">
      <span className="text-muted">
        The shell exited{code === 0 ? "" : ` with code ${code}`}.
      </span>
      <button
        ref={button}
        type="button"
        onClick={onRestart}
        className="flex h-7 items-center gap-1.5 rounded-md border border-hairline px-2.5 text-ink/80 transition-colors outline-none hover:bg-white/[0.05] hover:text-ink focus-visible:border-ice/40"
      >
        <ArrowClockwiseIcon className="size-3.5" />
        Start a new shell
      </button>
    </div>
  );
}
