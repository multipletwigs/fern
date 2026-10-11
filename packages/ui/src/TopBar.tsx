import type { ReactNode } from "react";

// The window's draggable title strip; its contents sit at the right.
export function TopBar({ children }: { children: ReactNode }) {
  return (
    <div className="drag relative z-10 flex h-12 shrink-0 items-center justify-end gap-5 px-5">
      {children}
    </div>
  );
}
