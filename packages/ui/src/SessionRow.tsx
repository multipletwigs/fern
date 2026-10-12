import { clsx } from "clsx";
import { Loader } from "./Loader";

// An Arc-style tab, text only: the active one is lifted off the sidebar, the rest only light up on
// hover. A live Session shows a loader where the others show time-ago on hover. A Session in the
// Flow shows its current Phase, and a dot while it waits at a Checkpoint. Pointing at it calls
// `onPreload`, so the Session can start loading before it's clicked.
export function SessionRow({
  title,
  active,
  live,
  lastActive,
  phase,
  waiting = false,
  onSelect,
  onPreload,
}: {
  title: string;
  active: boolean;
  live: boolean;
  // Shown on hover when not live, e.g. "5m".
  lastActive: string;
  // The current Phase's name, for a Session in the Flow.
  phase?: string | undefined;
  // Waiting at a Checkpoint for the developer.
  waiting?: boolean;
  onSelect: () => void;
  onPreload?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onPointerEnter={onPreload}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "group flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors",
        active
          ? "bg-white/[0.09] text-ink shadow-[0_1px_2px_rgb(0_0_0/0.5),inset_0_1px_0_rgb(255_255_255/0.06)]"
          : "text-ink/65 hover:bg-white/[0.04] hover:text-ink",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {phase && (
        <span className="shrink-0 font-mono text-[10px] tracking-wide text-faint uppercase">
          {phase}
        </span>
      )}
      {waiting && (
        <span
          role="status"
          aria-label="Waiting at a Checkpoint"
          className="size-1.5 shrink-0 rounded-full bg-amber"
        />
      )}
      {live ? (
        <Loader label="Live" className="shrink-0 text-base text-ink" />
      ) : (
        <span className="hidden shrink-0 font-mono text-[11px] text-faint tabular-nums group-hover:block">
          {lastActive}
        </span>
      )}
    </button>
  );
}
