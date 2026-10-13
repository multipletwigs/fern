import { XIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";
import type { ReactNode } from "react";

// One tab of a TabBar.
export type TabBarTab<Value extends string> = {
  value: Value;
  label: ReactNode;
  // What the tab shows, in full, on hover.
  title?: string;
  onClose?: () => void;
};

// Something other than a tab that sits in a TabBar's row, in its place among the tabs, such as a
// menu of tabs kept out of the bar.
export type TabBarSlot = { slot: string; element: ReactNode };

// Views of one column, one showing at a time, drawn as quiet labels; the selected one lifts. A tab
// given `onClose` has a close control, shown on hover and while it's selected. Tabs keep their
// width: when they don't fit, the bar scrolls sideways, and the selected tab scrolls into sight.
// Sits in the top bar, outside the window's drag area.
export function TabBar<Value extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: ReadonlyArray<TabBarTab<Value> | TabBarSlot>;
  value: Value;
  onChange: (value: Value) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="no-drag flex h-8 min-w-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden px-px [scrollbar-width:none]"
    >
      {tabs.map((tab) => {
        if ("slot" in tab)
          return (
            <div key={tab.slot} className="flex h-7 shrink-0 items-center">
              {tab.element}
            </div>
          );
        const selected = tab.value === value;
        return (
          <div
            key={tab.value}
            className={clsx(
              "group flex h-7 shrink-0 items-center rounded-md transition-colors",
              selected && "bg-white/[0.06]",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              ref={selected ? scrollIntoSight : undefined}
              title={tab.title}
              onClick={() => onChange(tab.value)}
              className={clsx(
                "flex h-full items-center gap-1.5 pl-2.5 text-[12px] whitespace-nowrap transition-colors",
                tab.onClose ? "pr-1" : "pr-2.5",
                selected ? "text-ink" : "text-muted hover:text-ink",
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
    </div>
  );
}

// Scrolls the bar just enough to show the selected tab, each time a tab becomes the selected one.
const scrollIntoSight = (tab: HTMLElement | null) =>
  tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
