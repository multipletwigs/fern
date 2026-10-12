import { clsx } from "clsx";
import type { ReactNode } from "react";

// Views of one column, one showing at a time, drawn as quiet labels; the selected one lifts. A
// muted tab is smaller and dimmer, for views that are mostly noise. Sits in the top bar, outside
// the window's drag area. Anything passed as children sits after the tabs.
export function TabBar<Value extends string>({
  tabs,
  value,
  onChange,
  label,
  children,
}: {
  tabs: ReadonlyArray<{
    value: Value;
    label: ReactNode;
    muted?: boolean;
    // What the tab shows, in full, on hover.
    title?: string;
  }>;
  value: Value;
  onChange: (value: Value) => void;
  label: string;
  // What follows the tabs, such as a menu of the ones that didn't fit.
  children?: ReactNode;
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
          title={tab.title}
          onClick={() => onChange(tab.value)}
          className={clsx(
            "flex min-w-0 items-center gap-1.5 rounded-md transition-colors",
            tab.muted
              ? "h-6 shrink px-2 text-[11px]"
              : "h-full shrink-0 px-2.5 text-[12px]",
            tab.value === value
              ? "bg-white/[0.06] text-ink"
              : tab.muted
                ? "text-faint hover:text-muted"
                : "text-muted hover:text-ink",
          )}
        >
          {tab.label}
        </button>
      ))}
      {children}
    </div>
  );
}
