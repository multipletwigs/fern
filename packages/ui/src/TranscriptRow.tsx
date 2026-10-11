import { clsx } from "clsx";
import { type ReactNode, useState } from "react";

// One transcript item, centred in the reading column. A row that arrived while the transcript was
// open fades in the first time it shows; scrolling it back into view later doesn't replay that.
export function TranscriptRow({
  id,
  fresh = false,
  children,
}: {
  id: string;
  fresh?: boolean;
  children: ReactNode;
}) {
  const [entering] = useState(fresh);
  return (
    // flow-root keeps item margins inside the row, so virtualized lists measure its true height.
    <div
      data-row-id={id}
      className={clsx(
        "mx-auto flow-root w-full max-w-[720px] px-6",
        entering && "motion-safe:animate-fade-in",
      )}
    >
      {children}
    </div>
  );
}
