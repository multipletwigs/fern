import { clsx } from "clsx";
import type { ReactNode } from "react";

// Two or more views of the same thing, one showing at a time. Sits in the top bar, outside the
// window's drag area.
export function SegmentedToggle<Value extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: Value; label: ReactNode }>;
  value: Value;
  onChange: (value: Value) => void;
}) {
  return (
    <div className="no-drag flex h-7 items-center rounded-lg border border-hairline p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={clsx(
            "flex h-full items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors",
            option.value === value
              ? "bg-white/[0.08] text-ink"
              : "text-muted hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
