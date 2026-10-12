import type { SubagentStatus } from "@repo/api";

// How many Subagent tabs the bar shows before the rest wait behind "+N".
const SHOWN = 4;

// Which of a Session's Subagents get their own tab, and which wait behind "+N". Both keep start
// order. Past four, finished Subagents overflow first, oldest first, so running ones stay in sight;
// the selected one stays too, even past four.
export function subagentTabs<
  Tab extends { agentId: string; status: SubagentStatus },
>(
  subagents: ReadonlyArray<Tab>,
  selected: string | undefined,
): { shown: ReadonlyArray<Tab>; overflow: ReadonlyArray<Tab> } {
  let excess = subagents.length - SHOWN;
  const hidden = new Set<string>();
  for (const subagent of subagents) {
    if (excess <= 0) break;
    if (subagent.status === "running" || subagent.agentId === selected)
      continue;
    hidden.add(subagent.agentId);
    excess--;
  }
  return {
    shown: subagents.filter((s) => !hidden.has(s.agentId)),
    overflow: subagents.filter((s) => hidden.has(s.agentId)),
  };
}
