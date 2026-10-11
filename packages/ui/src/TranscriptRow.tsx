import type { ReactNode } from "react";

// One transcript item, centred in the reading column.
export function TranscriptRow({ children }: { children: ReactNode }) {
  return (
    // flow-root keeps item margins inside the row, so virtualized lists measure its true height.
    <div className="mx-auto flow-root w-full max-w-[720px] px-6">
      {children}
    </div>
  );
}
