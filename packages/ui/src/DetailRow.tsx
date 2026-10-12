import { clsx } from "clsx";
import type { ReactNode } from "react";

// One fact in a DetailSection: its name, and its value on the right.
export function DetailRow({
  label,
  children,
  tone = "text-ink",
}: {
  label: string;
  children: ReactNode;
  tone?: string;
}) {
  return (
    <>
      <dt className="px-1.5 text-[12px] leading-5 text-muted">{label}</dt>
      <dd
        className={clsx(
          "px-1.5 text-right font-mono text-[11px] leading-5 tabular-nums",
          tone,
        )}
      >
        {children}
      </dd>
    </>
  );
}
