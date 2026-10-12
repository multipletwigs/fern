import { ArrowSquareOutIcon } from "@phosphor-icons/react";

// One isolated Fern running from a worktree: its branch, its page (opened in the browser), its
// API's port, and the Session it belongs to, when Fern can tell. Pointing at the branch shows the
// worktree's folder.
export function VerifySlotRow({
  slot,
  branch,
  worktree,
  pageUrl,
  apiPort,
  stopped,
  session,
}: {
  slot: number;
  // Null on a detached HEAD.
  branch: string | null;
  worktree: string;
  pageUrl: string;
  apiPort: number;
  // The slot's processes that have exited while others still run, e.g. ["electron"].
  stopped: ReadonlyArray<string>;
  session?:
    { readonly title: string; readonly onSelect: () => void } | undefined;
}) {
  const folder = worktree.split("/").at(-1);
  return (
    <div className="rounded-lg px-2.5 py-1.5 text-[13px] transition-colors hover:bg-white/[0.04]">
      <div className="flex h-5 items-center gap-2" title={worktree}>
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-mint" />
        <span className="min-w-0 flex-1 truncate text-ink/80">
          {branch ?? `detached HEAD · ${folder}`}
        </span>
        <span className="shrink-0 font-mono text-[10px] tracking-wide text-faint uppercase">
          Slot {slot}
        </span>
      </div>
      <div className="mt-0.5 flex h-5 items-center gap-3 pl-3.5 font-mono text-[11px] text-faint">
        <a
          href={pageUrl}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 items-center gap-1 text-muted transition-colors hover:text-ink"
        >
          <span className="truncate">
            {pageUrl.replace(/^https?:\/\//, "")}
          </span>
          <ArrowSquareOutIcon className="size-3 shrink-0" />
        </a>
        <span className="shrink-0 tabular-nums">API {apiPort}</span>
        {stopped.length > 0 && (
          <span className="truncate text-amber">
            {stopped.join(", ")} stopped
          </span>
        )}
      </div>
      {session && (
        <button
          type="button"
          onClick={session.onSelect}
          className="mt-0.5 flex h-5 w-full min-w-0 items-center pl-3.5 text-left text-xs text-faint transition-colors hover:text-ink"
        >
          <span className="truncate">{session.title}</span>
        </button>
      )}
    </div>
  );
}
