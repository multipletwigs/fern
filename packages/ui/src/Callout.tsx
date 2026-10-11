import { clsx } from "clsx";
import type { ReactNode } from "react";

// A short message set apart from what's around it. Amber asks for the developer's attention.
export function Callout({
  tone,
  children,
  action,
}: {
  tone: "amber" | "danger" | "muted";
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={clsx(
        "flex items-center gap-4 rounded-xl border px-4 py-3 text-[13px] leading-5",
        tone === "amber" && "border-amber/25 bg-amber/[0.05] text-amber/90",
        tone === "danger" && "border-danger/25 bg-danger/[0.05] text-danger/90",
        tone === "muted" && "border-hairline text-muted",
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
