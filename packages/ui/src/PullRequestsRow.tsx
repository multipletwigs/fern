import { GitPullRequestIcon } from "@phosphor-icons/react";

// A Project's Pull requests entry, at the top of its group in the sidebar. Lifted like a Session's
// row while its page is on screen.
export function PullRequestsRow({
  active,
  onSelect,
}: {
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-active={active || undefined}
      aria-current={active ? "page" : undefined}
      className="side-row gap-2.5 px-2.5 text-left"
    >
      <GitPullRequestIcon className="size-4 shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate">Pull requests</span>
    </button>
  );
}
