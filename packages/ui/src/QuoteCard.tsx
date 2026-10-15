import { XIcon } from "@phosphor-icons/react";

// The passage a message is about, quoted at the top of the composer, with where it's from and a
// way to drop it.
export function QuoteCard({
  about,
  text,
  onDismiss,
}: {
  about: string;
  text: string;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-start gap-2 px-4 pt-3">
      <div className="min-w-0 flex-1 border-l-2 border-amber/50 pl-3">
        <p className="truncate font-mono text-[11px] text-faint">{about}</p>
        <p className="mt-0.5 line-clamp-3 text-[13px] leading-5 whitespace-pre-line text-ink/70">
          {text}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        title="Drop the quote (Esc)"
        className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-ink"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
