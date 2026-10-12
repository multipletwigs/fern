import { GitBranchIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";

// Marks a Session that runs in a git worktree rather than the Project's own checkout: a branch
// icon, and the worktree's branch when `labelled`. Pointing at it names the branch and the folder.
export function WorktreeBadge({
  branch,
  path,
  labelled = false,
  className,
}: {
  branch: string | undefined;
  // The worktree's folder.
  path: string;
  labelled?: boolean;
  className?: string;
}) {
  const description = `In a git worktree${branch ? ` on ${branch}` : ""}: ${path}`;
  return (
    <span
      role="img"
      aria-label={description}
      title={description}
      className={clsx(
        "no-drag inline-flex min-w-0 items-center gap-1 text-faint",
        labelled &&
          "h-6 rounded-md bg-white/[0.05] px-2 font-mono text-[11px] text-muted",
        className,
      )}
    >
      <GitBranchIcon weight="bold" className="size-3.5 shrink-0" />
      {labelled && branch && <span className="truncate">{branch}</span>}
    </span>
  );
}
