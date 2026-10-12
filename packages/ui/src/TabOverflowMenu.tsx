import { Menu } from "@base-ui/react/menu";
import type { ReactNode } from "react";

// The tabs that didn't fit in a tab bar, behind a quiet "+N" at its end. Picking one selects it.
export function TabOverflowMenu<Value extends string>({
  tabs,
  onChange,
}: {
  tabs: ReadonlyArray<{
    value: Value;
    label: ReactNode;
    // What the tab shows, in full, on hover.
    title?: string;
  }>;
  onChange: (value: Value) => void;
}) {
  if (tabs.length === 0) return null;
  return (
    <Menu.Root>
      <Menu.Trigger
        title={`${tabs.length} more`}
        className="flex h-6 shrink-0 items-center rounded-md px-2 text-[11px] text-faint tabular-nums transition-colors hover:text-muted data-popup-open:bg-white/[0.06] data-popup-open:text-ink"
      >
        +{tabs.length}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-50"
        >
          <Menu.Popup className="max-h-[min(var(--available-height),28rem)] min-w-44 max-w-72 origin-(--transform-origin) overflow-y-auto rounded-xl bg-[#141414] p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.5),0_12px_32px_rgb(0_0_0/0.55),inset_0_1px_0_rgb(255_255_255/0.08)] outline-none transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            {tabs.map((tab) => (
              <Menu.Item
                key={tab.value}
                title={tab.title}
                onClick={() => onChange(tab.value)}
                className="flex h-8 cursor-default items-center gap-1.5 rounded-lg px-2.5 text-[12px] text-muted outline-none data-highlighted:bg-white/[0.06] data-highlighted:text-ink"
              >
                {tab.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
