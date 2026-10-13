import { CodeIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";

// In a Session's top bar: shows or hides its code panel, lit while it shows, with how many files
// the Session changed.
export function CodeToggle({
  open,
  changed,
  onToggle,
}: {
  open: boolean;
  changed: number;
  onToggle: () => void;
}) {
  const files = `${changed} changed ${changed === 1 ? "file" : "files"}`;
  const label = `${open ? "Hide" : "Show"} code (⌘\\), ${files}`;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={open}
      onClick={onToggle}
      className={clsx(
        "no-drag flex h-7 min-w-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-1.5 transition-colors hover:bg-side-field hover:text-ink",
        open ? "bg-side-field text-ink" : "text-muted",
      )}
    >
      <CodeIcon className="size-4" />
      {changed > 0 && (
        <span className="text-[12px] tabular-nums">{changed}</span>
      )}
    </button>
  );
}
