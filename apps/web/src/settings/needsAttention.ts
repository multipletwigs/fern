import type { DeveloperTool, ToolStatus } from "@repo/api";

// Tools Fern runs fine without: without gh-stack, Hosted Sessions land as they did before Stacks.
const OPTIONAL: ReadonlySet<DeveloperTool> = new Set(["gh-stack"]);

// Whether any of the developer's tools Fern needs isn't ready, for the sidebar's Settings row to
// flag.
export const needsAttention = (tools: ReadonlyArray<ToolStatus>) =>
  tools.some((tool) => !OPTIONAL.has(tool.tool) && tool.state !== "ready");
