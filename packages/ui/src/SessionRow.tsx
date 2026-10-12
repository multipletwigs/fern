import { clsx } from "clsx";
import type { ReactNode } from "react";
import { Loader } from "./Loader";

// An Arc-style tab, text only: the active one is lifted off the sidebar, the rest only light up on
// hover. A live Session shows a loader where the others show time-ago on hover. A Session in the
// Flow shows its current Phase, and a dot while it waits at a Checkpoint. Pointing at it calls
// `onPreload`, so the Session can start loading before it's clicked. An `action`, such as
// archiving, shows at its end on hover. A `badge`, such as the worktree mark, sits after the title.
export function SessionRow({
  title,
  active,
  live,
  lastActive,
  phase,
  waiting = false,
  onSelect,
  onPreload,
  action,
  badge,
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
  action?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div
      onPointerEnter={onPreload}
      data-active={active || undefined}
      className={clsx("group side-row pr-1", !action && "pr-2.5")}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "page" : undefined}
        className="flex h-full min-w-0 flex-1 items-center gap-2.5 pl-2.5 text-left"
      >
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {badge}
        {phase && (
          <span className="shrink-0 font-mono text-[10px] tracking-wide text-muted/80 uppercase">
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
          <span className="hidden shrink-0 font-mono text-[11px] text-muted/80 tabular-nums group-hover:block">
            {lastActive}
          </span>
        )}
      </button>
      {action && (
        <div className="ml-1 hidden shrink-0 group-focus-within:flex group-hover:flex">
          {action}
        </div>
      )}
    </div>
  );
}
