import { useRef } from "react";

// How far one arrow key press moves the edge.
const STEP = 24;

// The top edge of a Session's terminal, dragged up or down to make it taller or shorter. Reports
// the height the drag asks for; the caller keeps it in bounds.
export function TerminalResizeHandle({
  height,
  onHeightChange,
}: {
  height: number;
  onHeightChange: (height: number) => void;
}) {
  const drag = useRef<{ y: number; height: number }>(undefined);
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize terminal"
      aria-valuenow={height}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { y: event.clientY, height };
      }}
      onPointerMove={(event) => {
        const from = drag.current;
        if (from) onHeightChange(from.height + from.y - event.clientY);
      }}
      onPointerUp={() => {
        drag.current = undefined;
      }}
      onPointerCancel={() => {
        drag.current = undefined;
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") onHeightChange(height + STEP);
        else if (event.key === "ArrowDown") onHeightChange(height - STEP);
        else return;
        event.preventDefault();
      }}
      className="group absolute inset-x-0 -top-1 z-10 flex h-2 cursor-row-resize items-center justify-center pr-2 outline-none"
    >
      <div className="h-0.5 w-10 rounded-full bg-transparent transition-colors group-hover:bg-faint group-focus-visible:bg-ice/60 group-active:bg-ice/60" />
    </div>
  );
}
