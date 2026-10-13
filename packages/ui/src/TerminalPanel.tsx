import type { ReactNode } from "react";
import { TerminalResizeHandle } from "./TerminalResizeHandle";

// The card a Session's terminal sits in, along the bottom of its screen under the chat and the
// code, `height` tall and dragged taller or shorter by its top edge. Hidden, it keeps its
// contents, so the terminal in it stays as it was.
export function TerminalPanel({
  children,
  hidden,
  height,
  onHeightChange,
}: {
  children: ReactNode;
  hidden: boolean;
  height: number;
  onHeightChange: (height: number) => void;
}) {
  return (
    <section
      aria-label="Terminal"
      hidden={hidden}
      className="relative shrink-0 pr-2 pb-2"
      style={{ height }}
    >
      <TerminalResizeHandle height={height} onHeightChange={onHeightChange} />
      <div className="relative h-full overflow-hidden rounded-[10px] bg-panel shadow-panel">
        {children}
      </div>
    </section>
  );
}
