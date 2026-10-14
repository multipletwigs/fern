import type { ReactNode } from "react";

// The Pull requests page's controls over its list: the presets on top, then the filters and the
// search on one line.
export function PullRequestFilters({
  presets,
  children,
}: {
  presets: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      {presets}
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}
