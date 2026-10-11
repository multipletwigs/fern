import { Menu } from "@base-ui/react/menu";
import { CaretUpDownIcon, CheckIcon } from "@phosphor-icons/react";

export type ModelChoice = {
  // What Claude Code calls it, e.g. "opus".
  readonly value: string;
  readonly label: string;
};

// The model the next message runs on, as a quiet button in the composer that opens the models
// Claude Code offers above it.
export function ModelPicker({
  models,
  value,
  label,
  disabled,
  onChange,
}: {
  models: ReadonlyArray<ModelChoice>;
  // The model checked in the list, if one is.
  value: string | undefined;
  // What the button reads: the model the next message runs on.
  label: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={disabled || models.length === 0}
        title="Model"
        className="flex h-8 items-center gap-1 rounded-lg px-2 font-mono text-[11px] text-muted transition-colors hover:bg-white/[0.06] hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent data-popup-open:bg-white/[0.06] data-popup-open:text-ink"
      >
        {label}
        <CaretUpDownIcon className="size-3" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="top"
          align="start"
          sideOffset={8}
          className="z-50"
        >
          <Menu.Popup className="max-h-[min(var(--available-height),28rem)] min-w-44 origin-(--transform-origin) rounded-xl bg-[#141414] p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.5),0_12px_32px_rgb(0_0_0/0.55),inset_0_1px_0_rgb(255_255_255/0.08)] transition-[opacity,scale] duration-150 ease-out overflow-y-auto outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Menu.RadioGroup
              value={value ?? null}
              onValueChange={(picked: string) => onChange(picked)}
            >
              {models.map((model) => (
                <Menu.RadioItem
                  key={model.value}
                  value={model.value}
                  closeOnClick
                  className="flex cursor-default items-center gap-3 rounded-lg h-8 px-2.5 text-left outline-none data-highlighted:bg-white/[0.06]"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {model.label}
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
