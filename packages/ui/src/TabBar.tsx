import { XIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";
import type { ReactNode } from "react";

// Views of one column, one showing at a time, drawn as quiet labels; the selected one lifts. A
// muted tab is smaller and dimmer, for views that are mostly noise. A tab given `onClose` has a
// close control, shown on hover and while it's selected. Sits in the top bar, outside the window's
// drag area. Anything passed as children sits after the tabs.
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
    onClose?: () => void;
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
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <div
            key={tab.value}
            className={clsx(
              "group flex min-w-0 items-center rounded-md transition-colors",
              tab.muted ? "h-6 shrink" : "h-full shrink-0",
              selected && "bg-white/[0.06]",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              title={tab.title}
              onClick={() => onChange(tab.value)}
              className={clsx(
                "flex h-full min-w-0 items-center gap-1.5 transition-colors",
                tab.muted ? "pl-2 text-[11px]" : "pl-2.5 text-[12px]",
                tab.onClose ? "pr-1" : tab.muted ? "pr-2" : "pr-2.5",
                selected
                  ? "text-ink"
                  : tab.muted
                    ? "text-faint hover:text-muted"
                    : "text-muted hover:text-ink",
              )}
            >
              {tab.label}
            </button>
            {tab.onClose && (
              <button
                type="button"
                aria-label={`Close ${tab.title ?? "tab"}`}
                title="Close tab"
                onClick={tab.onClose}
                className={clsx(
                  "mr-1 flex size-4 shrink-0 items-center justify-center rounded text-faint transition-opacity hover:bg-white/[0.08] hover:text-ink focus-visible:opacity-100",
                  selected
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100",
                )}
              >
                <XIcon className="size-2.5" weight="bold" />
              </button>
            )}
          </div>
        );
      })}
      {children}
    </div>
  );
}
