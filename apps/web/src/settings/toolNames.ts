import type { DeveloperTool } from "@repo/api";

// How Settings names each of the developer's tools.
export const TOOL_NAMES: Record<DeveloperTool, string> = {
  claude: "Claude Code",
  gh: "GitHub CLI",
  git: "Git",
  "gh-stack": "GitHub Stacks",
};
