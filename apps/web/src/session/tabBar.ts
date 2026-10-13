import type { SubagentStatus } from "@repo/api";

// What the Session's tab bar says of its Subagents, which wait behind one Agents dropdown rather
// than take a tab each: how many there are, how many are still working, and the one selected,
// which shows in the bar as its one tab.
export function agentsMenu<
  Agent extends { agentId: string; status: SubagentStatus },
>(
  subagents: ReadonlyArray<Agent>,
  selected: string | undefined,
): { count: number; running: number; active: Agent | undefined } {
  return {
    count: subagents.length,
    running: subagents.filter((s) => s.status === "running").length,
    active: subagents.find((s) => s.agentId === selected),
  };
}
