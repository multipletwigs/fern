import { clsx } from "clsx";
import type { ReactNode } from "react";

// The key that does something, set as a small keycap.
export function KeyHint({
  children,
  active = false,
}: {
  children: ReactNode;
  // Lit when the thing it acts on is the one picked.
  active?: boolean;
}) {
  return (
    <kbd
      className={clsx(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md border px-1 font-mono text-[11px] transition-colors",
        active
          ? "border-ice/40 bg-ice/[0.12] text-ice"
          : "border-white/[0.1] text-muted",
      )}
    >
      {children}
    </kbd>
  );
}
