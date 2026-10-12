import { ListChecksIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";

// How a Walkthrough's review status is tinted: amber when it waits on the developer, shimmering
// while Claude writes it.
export type WalkthroughTone = "amber" | "writing" | "danger" | "muted";

// A Walkthrough in the code panel's list: its number and where its review stands. Lifted like a
// sidebar tab while it's on screen.
export function WalkthroughRow({
  number,
  status,
  tone,
  active,
  onSelect,
}: {
  number: number;
  status: string;
  tone: WalkthroughTone;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      data-active={active || undefined}
      className="side-row gap-2 px-2.5 text-left"
    >
      <ListChecksIcon className="size-3.5 shrink-0 text-muted/70" />
      <span className="min-w-0 flex-1 truncate">Walkthrough {number}</span>
      <span
        className={clsx(
          "shrink-0 text-[11px]",
          tone === "amber" && "text-amber/90",
          tone === "danger" && "text-danger/80",
          tone === "muted" && "text-muted/80",
          tone === "writing" &&
            "animate-shimmer bg-linear-to-r from-muted via-ink to-muted bg-[length:200%_100%] bg-clip-text text-transparent motion-reduce:animate-none",
        )}
      >
        {status}
      </span>
    </button>
  );
}
