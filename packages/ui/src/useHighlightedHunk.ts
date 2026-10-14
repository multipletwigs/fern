import { useEffect, useMemo, useState } from "react";
import type { HunkSide } from "@repo/api";
import { highlight, type Line } from "./highlight";

// The code of a hunk's lines on one side of the change, past their +/- markers: context and
// removed lines before it, context and added lines after.
const sideOf = (lines: ReadonlyArray<string>, side: HunkSide) =>
  lines
    .filter((line) =>
      side === "before"
        ? !line.startsWith("+") && !line.startsWith("\\")
        : !line.startsWith("-") && !line.startsWith("\\"),
    )
    .map((line) => line.slice(1))
    .join("\n");

const useHighlightedSide = (path: string, code: string) => {
  const [highlighted, setHighlighted] = useState<{
    code: string;
    lines: ReadonlyArray<Line>;
  }>();
  useEffect(() => {
    let current = true;
    void highlight(path, code).then((lines) => {
      if (current && lines) setHighlighted({ code, lines });
    });
    return () => {
      current = false;
    };
  }, [path, code]);
  return highlighted?.code === code ? highlighted.lines : undefined;
};

// A hunk's lines highlighted as the file reads on each side of the change, so a removed line is
// tokenized among the lines it sat with and an added one among its own. Each entry lines up with a
// line of the hunk; it's undefined until the worker answers, for a language Shiki doesn't know, and
// for a "\ No newline" note.
export const useHighlightedHunk = (
  path: string,
  lines: ReadonlyArray<string>,
): ReadonlyArray<Line | undefined> => {
  const before = useHighlightedSide(
    path,
    useMemo(() => sideOf(lines, "before"), [lines]),
  );
  const after = useHighlightedSide(
    path,
    useMemo(() => sideOf(lines, "after"), [lines]),
  );
  return useMemo(() => {
    let inBefore = 0;
    let inAfter = 0;
    return lines.map((line) => {
      if (line.startsWith("\\")) return undefined;
      if (line.startsWith("-")) return before?.[inBefore++];
      if (line.startsWith("+")) return after?.[inAfter++];
      inBefore++;
      return after?.[inAfter++];
    });
  }, [lines, before, after]);
};
