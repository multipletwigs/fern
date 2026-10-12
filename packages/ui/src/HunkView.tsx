import { DiffLine } from "./DiffLine";
import { useHighlightedHunk } from "./useHighlightedHunk";

// One hunk of a diff: its header, then its lines with the code in its syntax colors. Lines left
// out to keep things small are counted at the end.
export function HunkView({
  path,
  header,
  lines,
  omitted,
}: {
  // The file the hunk is in, which picks the language to highlight.
  path: string;
  header: string;
  lines: ReadonlyArray<string>;
  omitted: number;
}) {
  const tokens = useHighlightedHunk(path, lines);
  return (
    <div className="font-mono text-xs leading-5">
      <div className="px-3 py-1 text-faint">{header}</div>
      {lines.map((line, index) => (
        <DiffLine
          // Lines in a hunk are positional; nothing else identifies them.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          line={line}
          tokens={tokens[index]}
        />
      ))}
      {omitted > 0 && (
        <div className="px-3 py-1 text-faint">
          … {omitted} more {omitted === 1 ? "line" : "lines"}
        </div>
      )}
    </div>
  );
}
