import type { TranscriptItem } from "@repo/api";
import { toolGroup } from "./toolName";

export type ToolCall = Extract<TranscriptItem, { _tag: "ToolCall" }>;

// What the transcript list renders: an item, or a run of back-to-back calls to one tool (or one
// MCP server) shown as one row.
export type Row =
  | {
      readonly _tag: "Item";
      readonly id: string;
      readonly item: TranscriptItem;
    }
  | {
      readonly _tag: "ToolRun";
      // The first call's id, so the row keeps its identity as the run grows.
      readonly id: string;
      // The tool, or "mcp__<server>" for a run across one server's tools.
      readonly name: string;
      readonly calls: ReadonlyArray<ToolCall>;
    };

// AskUserQuestion and Grill suggestions render as cards, so they never fold into a run.
const foldable = (item: TranscriptItem): item is ToolCall =>
  item._tag === "ToolCall" &&
  item.questions === undefined &&
  item.grillSuggestion === undefined;

export const toRows = (items: ReadonlyArray<TranscriptItem>) => {
  const rows: Array<Row> = [];
  let run: Array<ToolCall> = [];
  const flush = () => {
    const [first] = run;
    if (run.length === 1 && first)
      rows.push({ _tag: "Item", id: first.id, item: first });
    else if (first)
      rows.push({
        _tag: "ToolRun",
        id: first.id,
        name: toolGroup(first.name),
        calls: run,
      });
    run = [];
  };
  for (const item of items) {
    if (foldable(item)) {
      if (run[0] && toolGroup(run[0].name) !== toolGroup(item.name)) flush();
      run.push(item);
      continue;
    }
    flush();
    rows.push({ _tag: "Item", id: item.id, item });
  }
  flush();
  return rows;
};
