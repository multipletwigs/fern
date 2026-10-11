import { memo } from "react";
import type { Line } from "./highlight";

// One numbered line of code; its number stays put while the line scrolls sideways.
export const CodeLine = memo(function CodeLine({
  number,
  gutter,
  line,
}: {
  number: number;
  // Characters in the widest line number.
  gutter: number;
  line: Line;
}) {
  return (
    <div className="flex h-5 hover:bg-white/[0.025]">
      <span
        className="sticky left-0 shrink-0 bg-[#0a0a0a] pr-4 pl-4 text-right text-faint select-none"
        style={{ width: `${gutter + 3}ch` }}
      >
        {number}
      </span>
      <span className="pr-6 whitespace-pre text-ink/90">
        {line.map(([content, color], at) => (
          <span
            // Tokens are positional; nothing else identifies them.
            // oxlint-disable-next-line react/no-array-index-key
            key={at}
            style={color ? { color } : undefined}
          >
            {content}
          </span>
        ))}
      </span>
    </div>
  );
});
