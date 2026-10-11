import type { ReactNode } from "react";
import { ContentPanel } from "./ContentPanel";

// The chat and, once there is code to show, the code beside it. Without code the chat takes the
// whole width; when code arrives the chat glides into a column on the right and the code fades in
// to fill the center. Unless `animate`, it snaps to the new layout instead, as when switching to
// another Session.
export function Workbench({
  chat,
  code,
  animate = true,
}: {
  chat: ReactNode;
  code: ReactNode | undefined;
  animate?: boolean;
}) {
  const split = code !== undefined;
  return (
    <div className="flex min-w-0 flex-1 overflow-hidden">
      {split && (
        <div
          className={`min-w-0 flex-1 ${animate ? "transition-opacity delay-150 duration-500 ease-out starting:opacity-0 motion-reduce:transition-none" : ""}`}
        >
          <ContentPanel>{code}</ContentPanel>
        </div>
      )}
      <div
        className={`shrink-0 ${animate ? "transition-[width] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none" : ""}`}
        style={{ width: split ? 440 : "100%" }}
      >
        <ContentPanel>{chat}</ContentPanel>
      </div>
    </div>
  );
}
