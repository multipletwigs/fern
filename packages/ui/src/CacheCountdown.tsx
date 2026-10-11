import { clsx } from "clsx";

// Time left before the prompt cache goes cold and the next message pays a full cache rewrite.
export function CacheCountdown({ remainingMs }: { remainingMs: number }) {
  const cold = remainingMs <= 0;
  const seconds = Math.max(0, Math.floor(remainingMs / 1000));
  const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <span
      className="flex items-baseline gap-2 text-xs text-muted"
      title="Prompt cache time remaining"
    >
      cache
      <span
        className={clsx(
          "font-pixel text-xl leading-none tabular-nums",
          cold ? "text-faint" : seconds < 300 ? "text-amber" : "text-ink",
        )}
      >
        {cold ? "cold" : label}
      </span>
    </span>
  );
}
