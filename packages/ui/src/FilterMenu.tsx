import { Menu } from "@base-ui/react/menu";
import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";

export type FilterChoice = {
  readonly value: string;
  readonly label: string;
};

// One filter over a list, as a quiet button reading what it's set to, that opens its choices
// below it. Lit while it narrows the list.
export function FilterMenu({
  name,
  choices,
  value,
  active,
  onChange,
}: {
  // What the filter is, as the button reads it before its choice: "Author".
  name: string;
  choices: ReadonlyArray<FilterChoice>;
  value: string;
  // Whether the choice narrows the list.
  active: boolean;
  onChange: (value: string) => void;
}) {
  const current = choices.find((c) => c.value === value);
  return (
    <Menu.Root>
      <Menu.Trigger
        className={clsx(
          "flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] transition-colors hover:bg-white/[0.05] data-popup-open:bg-white/[0.05]",
          active
            ? "border-ice/30 text-ink"
            : "border-hairline text-muted hover:text-ink",
        )}
      >
        <span className="text-faint">{name}</span>
        <span className="max-w-32 truncate">{current?.label ?? value}</span>
        <CaretDownIcon className="size-3 text-faint" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-50"
        >
          <Menu.Popup className="max-h-[min(var(--available-height),24rem)] min-w-40 origin-(--transform-origin) overflow-y-auto rounded-xl bg-[#141414] p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.5),0_12px_32px_rgb(0_0_0/0.55),inset_0_1px_0_rgb(255_255_255/0.08)] transition-[opacity,scale] duration-150 ease-out outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Menu.RadioGroup
              value={value}
              onValueChange={(picked: string) => onChange(picked)}
            >
              {choices.map((choice) => (
                <Menu.RadioItem
                  key={choice.value}
                  value={choice.value}
                  closeOnClick
                  className="flex h-8 cursor-default items-center gap-3 rounded-lg px-2.5 text-left outline-none data-highlighted:bg-white/[0.06]"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {choice.label}
                  </span>
                  <Menu.RadioItemIndicator className="shrink-0 text-ink">
                    <CheckIcon className="size-3.5" />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
