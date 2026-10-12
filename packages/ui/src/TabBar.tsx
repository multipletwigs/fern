import { clsx } from "clsx";
import type { ReactNode } from "react";

// Views of one column, one showing at a time, drawn as quiet labels; the selected one lifts.
// Sits in the top bar, outside the window's drag area.
export function TabBar<Value extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: ReadonlyArray<{ value: Value; label: ReactNode }>;
  value: Value;
  onChange: (value: Value) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="no-drag flex h-7 min-w-0 items-center gap-0.5"
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          onClick={() => onChange(tab.value)}
          className={clsx(
            "flex h-full items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors",
            tab.value === value
              ? "bg-white/[0.06] text-ink"
              : "text-muted hover:text-ink",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
