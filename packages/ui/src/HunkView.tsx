import { clsx } from "clsx";

// One hunk of a diff: its header, then its lines with the added and removed ones tinted. Lines
// left out to keep things small are counted at the end.
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
    <div className="overflow-x-auto font-mono text-xs leading-5">
      <div className="px-3 py-1 text-faint">{header}</div>
      {lines.map((line, index) => (
        <div
          // Lines in a hunk are positional; nothing else identifies them.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          className={clsx(
            "min-w-max px-3 whitespace-pre",
            line.startsWith("+")
              ? "bg-ice/[0.06] text-ice/90"
              : line.startsWith("-")
                ? "bg-danger/[0.06] text-danger/80"
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
