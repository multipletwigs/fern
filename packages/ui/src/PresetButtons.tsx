import { clsx } from "clsx";

export type PresetChoice = {
  readonly value: string;
  readonly label: string;
};

// A row of buttons, each setting a list's filters to a common view, the one they're on pressed.
// None is pressed once the filters are set some other way.
export function PresetButtons({
  label,
  presets,
  value,
  onPick,
}: {
  // What the row is, for screen readers.
  label: string;
  presets: ReadonlyArray<PresetChoice>;
  value: string | undefined;
  onPick: (value: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex w-fit items-center gap-0.5 rounded-lg border border-hairline p-0.5"
    >
      {presets.map((preset) => (
        <button
          key={preset.value}
          type="button"
          aria-pressed={preset.value === value}
          onClick={() => onPick(preset.value)}
          className={clsx(
            "h-7 rounded-md px-3 text-[12px] transition-colors",
            preset.value === value
              ? "bg-white/[0.08] text-ink"
              : "text-muted hover:bg-white/[0.04] hover:text-ink",
          )}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
