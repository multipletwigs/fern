import { clsx } from "clsx";
import type { ReactNode } from "react";

// A small pill on a pull request's row, such as "Draft". Amber asks for the developer's attention.
export function PullRequestMark({
  tone,
  children,
}: {
  tone: "amber" | "muted";
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        "shrink-0 rounded-full border px-2 py-px text-[11px]",
        tone === "amber" && "border-amber/25 text-amber/90",
        tone === "muted" && "border-hairline text-muted",
      )}
    >
      {children}
    </span>
  );
}
