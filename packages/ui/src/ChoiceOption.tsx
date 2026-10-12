import { CheckIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";
import { KeyHint } from "./KeyHint";

// One answer to choose from, with the key that picks it. The agent's recommendation says so.
export function ChoiceOption({
  label,
  shortcut,
  selected,
  recommended,
  onSelect,
}: {
  label: string;
  shortcut: string;
  selected: boolean;
  recommended: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={clsx(
        "group flex min-h-12 w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-[15px] transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.995]",
        selected
          ? "border-ice/45 bg-ice/[0.07] text-ink"
          : "border-white/[0.09] text-ink/80 hover:border-white/[0.16] hover:bg-white/[0.03] hover:text-ink",
      )}
    >
      <KeyHint active={selected}>{shortcut}</KeyHint>
      <span className="min-w-0 flex-1 leading-6">{label}</span>
      {recommended && (
        <span className="shrink-0 rounded-full border border-amber/25 bg-amber/[0.06] px-2 py-0.5 font-mono text-[10px] tracking-wide text-amber/90 uppercase">
          Recommended
        </span>
      )}
      <CheckIcon
        weight="bold"
        className={clsx(
          "size-4 shrink-0 text-ice transition-opacity",
          selected ? "opacity-100" : "opacity-0",
        )}
      />
    </button>
  );
}
