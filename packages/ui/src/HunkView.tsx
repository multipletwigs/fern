import { clsx } from "clsx";

// One hunk of a diff: its header, then its lines, added ones green and removed ones red. Long lines
// wrap, their continuations indented past the +/- so the column of markers stays clean. Lines left
// out to keep things small are counted at the end.
export function HunkView({
  header,
  lines,
  omitted,
}: {
  header: string;
  lines: ReadonlyArray<string>;
  omitted: number;
}) {
  return (
    <div className="font-mono text-xs leading-5">
      <div className="px-3 py-1 text-faint">{header}</div>
      {lines.map((line, index) => (
        <div
          // Lines in a hunk are positional; nothing else identifies them.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          className={clsx(
            "-indent-[1ch] pr-3 pl-[calc(0.75rem+1ch)] whitespace-pre-wrap wrap-anywhere",
            line.startsWith("+")
              ? "bg-mint/[0.07] text-mint/90"
              : line.startsWith("-")
                ? "bg-danger/[0.07] text-danger/85"
                : line.startsWith("\\")
                  ? "text-faint"
                  : "text-ink/60",
          )}
        >
          {line}
        </div>
      ))}
      {omitted > 0 && (
        <div className="px-3 py-1 text-faint">
          … {omitted} more {omitted === 1 ? "line" : "lines"}
        </div>
      )}
    </div>
  );
}
