import { clsx } from "clsx";
import type { ReactNode } from "react";

// Arc-style content card: inset from the window edges, rounded, and lifted off the canvas. "fill"
// takes the remaining width; "side" is a fixed-width column.
export function ContentPanel({
  size = "fill",
  children,
}: {
  size?: "fill" | "side";
  children: ReactNode;
}) {
  return (
    <main
      className={clsx(
        "min-w-0 py-2 pr-2",
        size === "fill" ? "flex-1" : "w-[440px] shrink-0",
      )}
    >
      <div className="relative h-full overflow-hidden rounded-xl border border-hairline bg-[#0a0a0a] shadow-[0_8px_30px_rgb(0_0_0/0.5)]">
        {children}
      </div>
    </main>
  );
}
