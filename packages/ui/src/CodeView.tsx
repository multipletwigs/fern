import { useEffect, useMemo, useState } from "react";
import { type Components, Virtuoso } from "react-virtuoso";
import { CodeLine } from "./CodeLine";
import { highlight, type Line } from "./highlight";

// An unwrapped line's height, which the list guesses before it measures a line.
const LINE_HEIGHT = 20;

const plain = (text: string): Line => [[text, undefined]];
const textOf = (line: Line) => line.map(([content]) => content).join("");

// The content's highlighted lines once the worker has them. Until then, a line that read the same
// in the previous highlighting keeps its colors, so a file changing on disk doesn't flash plain.
const useHighlighted = (path: string, content: string) => {
  const [highlighted, setHighlighted] = useState<{
    content: string;
    lines: ReadonlyArray<Line>;
  }>();

  useEffect(() => {
    let current = true;
    void highlight(path, content).then((lines) => {
      if (current && lines) setHighlighted({ content, lines });
    });
    return () => {
      current = false;
    };
  }, [path, content]);

  return useMemo(() => {
    if (highlighted?.content === content) return highlighted.lines;
    const previous = new Map(
      highlighted?.lines.map((line) => [textOf(line), line]),
    );
    return content.split("\n").map((text) => previous.get(text) ?? plain(text));
  }, [highlighted, content]);
};

interface Context {
  // Characters in the widest line number.
  readonly gutter: number;
}

const components: Components<Line, Context> = {
  Header: () => <div className="h-3" />,
  Footer: () => <div className="h-3" />,
};

const renderLine = (index: number, line: Line, context: Context) => (
  <CodeLine number={index + 1} gutter={context.gutter} line={line} />
);

// A file's content with line numbers and syntax highlighting, long lines wrapped. Only the lines in
// view are on the page, so a long file opens about as fast as a short one.
export function CodeView({ path, content }: { path: string; content: string }) {
  const lines = useHighlighted(path, content);
  const context = useMemo(
    (): Context => ({ gutter: String(lines.length).length }),
    [lines],
  );

  return (
    <Virtuoso
      className="h-full font-mono text-[12.5px] leading-5 text-ink/90"
      data={lines}
      context={context}
      components={components}
      itemContent={renderLine}
      defaultItemHeight={LINE_HEIGHT}
      increaseViewportBy={LINE_HEIGHT * 20}
    />
  );
}
