import type { ToolStatus } from "@repo/api";

// Whether any of the developer's tools isn't ready, for the sidebar's Settings row to flag.
export const needsAttention = (tools: ReadonlyArray<ToolStatus>) =>
  tools.some((tool) => tool.state !== "ready");
