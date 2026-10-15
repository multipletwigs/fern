import { clsx } from "clsx";
import type { ReactNode } from "react";

// A filter over a list that's either on or off, as a quiet button lit while it's on.
export function FilterToggle({
  pressed,
  onChange,
  children,
}: {
  pressed: boolean;
  onChange: (pressed: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      className={clsx(
        "flex h-7 items-center rounded-lg border px-2.5 text-[12px] transition-colors hover:bg-white/[0.05]",
        pressed
          ? "border-ice/30 text-ink"
          : "border-hairline text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
