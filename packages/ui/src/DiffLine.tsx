import { clsx } from "clsx";
import { memo } from "react";
import type { Line } from "./highlight";

// One line of a diff: a green border and "+" for an added line, a red one and "-" for a removed
// one, and the code in its syntax colors, plain until they arrive. Long lines wrap, their
// continuations indented past the marker so the column of markers stays clean.
export const DiffLine = memo(function DiffLine({
  line,
  tokens,
}: {
  // A unified-diff line: " context", "+added", "-removed" or "\ No newline at end of file".
  line: string;
  tokens: Line | undefined;
}) {
  const added = line.startsWith("+");
  const removed = line.startsWith("-");
  if (line.startsWith("\\"))
    return (
      <div className="border-l-2 border-transparent pr-3 pl-[calc(0.625rem+2ch)] text-faint">
        {line.slice(1).trim()}
      </div>
    );
  return (
    <div
      className={clsx(
        "flex border-l-2 pr-3 pl-2.5",
        added
          ? "border-mint/60 bg-mint/[0.05]"
          : removed
            ? "border-danger/60 bg-danger/[0.05]"
            : "border-transparent",
      )}
    >
      <span
        aria-hidden
        className={clsx(
          "w-[2ch] shrink-0 select-none",
          added ? "text-mint/80" : "text-danger/80",
        )}
      >
        {added ? "+" : removed ? "-" : ""}
      </span>
      <span
        className={clsx(
          "min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere text-ink/85",
          !added && !removed && "opacity-70",
        )}
      >
        {tokens
          ? tokens.map(([content, color], at) => (
              <span
                // Tokens are positional; nothing else identifies them.
                // oxlint-disable-next-line react/no-array-index-key
                key={at}
                style={color ? { color } : undefined}
              >
                {content}
              </span>
            ))
          : line.slice(1)}
      </span>
    </div>
  );
});
