import { clsx } from "clsx";
import type { Ref } from "react";
import { KeyHint } from "./KeyHint";

// An answer in the developer's own words, in place of the options. It grows with what's typed;
// Enter accepts it, Shift+Enter starts a new line, Escape leaves the field.
export function FreeTextAnswer({
  value,
  shortcut,
  selected,
  inputRef,
  onChange,
  onAccept,
}: {
  value: string;
  shortcut: string;
  selected: boolean;
  inputRef?: Ref<HTMLTextAreaElement>;
  onChange: (value: string) => void;
  onAccept: () => void;
}) {
  return (
    <label
      className={clsx(
        "flex min-h-12 w-full cursor-text items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors",
        selected
          ? "border-ice/45 bg-ice/[0.07]"
          : "border-dashed border-white/[0.12] hover:border-white/[0.2]",
      )}
    >
      <KeyHint active={selected}>{shortcut}</KeyHint>
      <textarea
        ref={inputRef}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => onChange(value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (value.trim()) onAccept();
          }
          if (event.key === "Escape") event.currentTarget.blur();
        }}
        placeholder="Or answer in your own words…"
        className="max-h-40 min-w-0 flex-1 resize-none bg-transparent text-[15px] leading-6 text-ink outline-none [field-sizing:content] placeholder:text-faint"
      />
    </label>
  );
}
