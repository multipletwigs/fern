import type { ReactNode } from "react";

// Arc-style content card: inset from the window edges, rounded, and lifted off the lighter frame
// the sidebar sits on. Fills whatever space its parent gives it.
export function ContentPanel({ children }: { children: ReactNode }) {
  return (
    <main className="h-full min-w-0 py-2 pr-2">
      <div className="relative h-full overflow-hidden rounded-[10px] bg-panel shadow-panel">
        {children}
      </div>
    </main>
  );
}
