import type { ReactNode } from "react";

// Arc-style content card: inset from the window edges, rounded, and lifted off the canvas. Fills
// whatever space its parent gives it.
export function ContentPanel({ children }: { children: ReactNode }) {
  return (
    <main className="h-full min-w-0 py-2 pr-2">
      <div className="relative h-full overflow-hidden rounded-xl border border-hairline bg-[#0a0a0a] shadow-[0_8px_30px_rgb(0_0_0/0.5)]">
        {children}
      </div>
    </main>
  );
}
