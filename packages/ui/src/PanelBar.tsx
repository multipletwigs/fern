import type { ReactNode } from "react";

// A panel's draggable title strip, with controls at either end. Controls opt out of dragging.
export function PanelBar({
  start,
  end,
}: {
  start?: ReactNode;
  end?: ReactNode;
}) {
  return (
    <div className="drag relative z-10 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-hairline px-3">
      <div className="no-drag flex min-w-0 items-center gap-2">{start}</div>
      <div className="no-drag flex shrink-0 items-center gap-2">{end}</div>
    </div>
  );
}
