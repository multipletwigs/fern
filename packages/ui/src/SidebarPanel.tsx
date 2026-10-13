import type { ReactNode } from "react";

// Arc-style sidebar: no divider, it shares the window's surface and the content panel floats beside it.
// The `footer`, such as the Settings entry, stays at the bottom while the rest scrolls.
export function SidebarPanel({
  header,
  footer,
  children,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <nav className="flex w-[264px] shrink-0 flex-col">
      {/* Room for the inset traffic lights. */}
      <div className="drag h-12 shrink-0" />
      {header && <div className="shrink-0 px-2.5 pb-3">{header}</div>}
      <div className="flex-1 overflow-y-auto px-2.5 pb-6">{children}</div>
      {footer && <div className="shrink-0 px-2.5 pt-1 pb-2.5">{footer}</div>}
    </nav>
  );
}
