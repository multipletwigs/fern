import { TerminalWindowIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";

// In a Session's top bar: shows or hides its terminal, lit while it shows.
export function TerminalToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const label = `${open ? "Hide" : "Show"} terminal (Ctrl+\`)`;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={open}
      onClick={onToggle}
      className={clsx(
        "no-drag flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-side-field hover:text-ink",
        open ? "bg-side-field text-ink" : "text-muted",
      )}
    >
      <TerminalWindowIcon className="size-4" />
    </button>
  );
}
