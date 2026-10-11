import { XIcon } from "@phosphor-icons/react";

export type QueuedItem = {
  readonly id: string;
  readonly text: string;
  // How many images it carries.
  readonly images: number;
};

// Messages waiting for the running turn, in the order they'll run, stacked just above the
// composer. Each can be taken back before it runs.
export function QueuedMessages({
  items,
  onRemove,
}: {
  items: ReadonlyArray<QueuedItem>;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ol className="mb-2 space-y-1">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex h-9 items-center gap-2.5 rounded-xl bg-white/[0.035] pr-1 pl-3 text-[13px] text-ink/70"
        >
          <span className="shrink-0 font-mono text-[11px] text-faint">
            Queued
          </span>
          <span className="min-w-0 flex-1 truncate">
            {item.text ||
              (item.images === 1 ? "An image" : `${item.images} images`)}
          </span>
          {item.text && item.images > 0 && (
            <span className="shrink-0 font-mono text-[11px] text-faint">
              +{item.images} {item.images === 1 ? "image" : "images"}
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            title="Remove from queue"
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-ink"
          >
            <XIcon className="size-3.5" />
          </button>
        </li>
      ))}
    </ol>
  );
}
