import type { ReactNode } from "react";

// The card a Session's terminal sits in, along the bottom of its screen under the chat and the
// code. Hidden, it keeps its contents, so the terminal in it stays as it was.
export function TerminalPanel({
  children,
  hidden,
  height,
}: {
  children: ReactNode;
  hidden: boolean;
  height: number;
}) {
  return (
    <section
      aria-label="Terminal"
      hidden={hidden}
      className="shrink-0 pr-2 pb-2"
      style={{ height }}
    >
      <div className="h-full overflow-hidden rounded-[10px] bg-panel py-2 pl-3 shadow-panel">
        {children}
      </div>
    </section>
  );
}
