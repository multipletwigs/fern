import { memo } from "react";
import type { Line } from "./highlight";

// One numbered line of code. A long line wraps, its continuations aligned past the number.
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
    <div className="flex min-h-5 hover:bg-white/[0.025]">
      <span
        className="shrink-0 pr-4 pl-4 text-right text-faint select-none"
        style={{ width: `${gutter + 3}ch` }}
      >
        {number}
      </span>
      <span className="min-w-0 flex-1 pr-6 whitespace-pre-wrap wrap-anywhere text-ink/90">
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
