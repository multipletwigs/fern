import { useEffect, useMemo, useState } from "react";
import { type Components, Virtuoso } from "react-virtuoso";
import { CodeLine } from "./CodeLine";
import { highlight, type Line } from "./highlight";

// Every line is this tall, so the list never measures one.
const LINE_HEIGHT = 20;
// A tab's width, as `pre` renders it.
const TAB = 8;

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
  // Characters in the widest line, tabs expanded.
  readonly widest: number;
}

const components: Components<Line, Context> = {
  Header: () => <div className="h-3" />,
  Footer: () => <div className="h-3" />,
  // Lines off screen aren't on the page to stretch it, so the list takes the widest line's width
  // up front: the gutter, the line, and its right padding.
  List: ({ style, children, ref, context }) => (
    <div
      ref={ref}
      style={{
        ...style,
        minWidth: `calc(${context.gutter + 3 + context.widest}ch + 1.5rem)`,
      }}
    >
      {children}
    </div>
  ),
};

const renderLine = (index: number, line: Line, context: Context) => (
  <CodeLine number={index + 1} gutter={context.gutter} line={line} />
);

// A file's content with line numbers and syntax highlighting. Only the lines in view are on the
// page, so a long file opens about as fast as a short one.
export function CodeView({ path, content }: { path: string; content: string }) {
  const lines = useHighlighted(path, content);
  const context = useMemo(
    (): Context => ({
      gutter: String(lines.length).length,
      widest: Math.max(
        0,
        ...lines.map((line) => {
          const text = textOf(line);
          return text.length + (TAB - 1) * (text.split("\t").length - 1);
        }),
      ),
    }),
    [lines],
  );

  return (
    <Virtuoso
      className="h-full font-mono text-[12.5px] leading-5 text-ink/90"
      data={lines}
      context={context}
      components={components}
      itemContent={renderLine}
      fixedItemHeight={LINE_HEIGHT}
      increaseViewportBy={LINE_HEIGHT * 20}
    />
  );
}
