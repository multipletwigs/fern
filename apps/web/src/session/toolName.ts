// How a tool is named in the transcript; MCP tools drop their "mcp__" prefix.
export const displayName = (name: string) =>
  name.startsWith("mcp__") ? name.split("__").slice(1).join(" · ") : name;

// The tools whose calls fold together: one tool, or every tool of one MCP server.
export const toolGroup = (name: string) =>
  name.startsWith("mcp__") ? name.split("__").slice(0, 2).join("__") : name;

const nouns: Record<string, string> = {
  Bash: "commands",
  Read: "files",
  Edit: "edits",
  Write: "files",
  Grep: "searches",
  Glob: "searches",
  WebFetch: "pages",
  WebSearch: "searches",
};

// What a run of calls to one tool amounts to, e.g. "5 commands".
export const runSummary = (name: string, count: number) =>
  `${count} ${nouns[name] ?? "calls"}`;
