import type { ReactNode } from "react";

// A file's hunks under its path, in a sunken well.
export function FileHunks({
  path,
  label,
  children,
}: {
  path: string;
  // A short tag beside the path, e.g. "Not from this Session".
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-white/[0.02]">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <span className="truncate font-mono text-xs text-ink/80">{path}</span>
        {label && (
          <span className="shrink-0 rounded-full border border-amber/30 px-2 py-0.5 text-[11px] text-amber/90">
            {label}
          </span>
        )}
      </div>
      <div className="divide-y divide-hairline py-1">{children}</div>
    </div>
  );
}
