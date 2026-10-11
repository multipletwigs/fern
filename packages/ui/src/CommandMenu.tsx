import { clsx } from "clsx";
import { useEffect, useRef } from "react";

export type ComposerCommand = {
  // Without the leading slash.
  readonly name: string;
  readonly description: string;
  readonly argumentHint: string;
};

// The slash commands matching what's typed, floating above the composer. Arrow keys move the
// highlight; the composer decides what Enter and Tab do with it.
export function CommandMenu({
  commands,
  highlighted,
  onHighlight,
  onPick,
}: {
  commands: ReadonlyArray<ComposerCommand>;
  highlighted: number;
  onHighlight: (index: number) => void;
  onPick: (command: ComposerCommand) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.children[highlighted]?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  return (
    <div
      ref={list}
      role="listbox"
      className="absolute inset-x-0 bottom-full mb-2 max-h-72 overflow-y-auto rounded-xl bg-[#141414] p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.5),0_12px_32px_rgb(0_0_0/0.55),inset_0_1px_0_rgb(255_255_255/0.08)]"
    >
      {commands.map((command, index) => (
        <button
          key={command.name}
          type="button"
          role="option"
          aria-selected={index === highlighted}
          // Keep focus in the textarea so typing carries on after a click.
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => onHighlight(index)}
          onClick={() => onPick(command)}
          className={clsx(
            "flex w-full items-baseline gap-3 rounded-lg px-2.5 py-1.5 text-left",
            index === highlighted && "bg-white/[0.08]",
          )}
        >
          <span className="shrink-0 font-pixel text-[13px] text-ink">
            /{command.name}
            {command.argumentHint && (
              <span className="text-faint"> {command.argumentHint}</span>
            )}
          </span>
          <span className="truncate text-xs text-muted">
            {command.description}
          </span>
        </button>
      ))}
    </div>
  );
}
