import type { SubagentSummary } from "@repo/api";
import { SubagentTabLabel } from "@repo/ui/SubagentTabLabel";
import { TabBar } from "@repo/ui/TabBar";
import { TabOverflowMenu } from "@repo/ui/TabOverflowMenu";
import type { ReactNode } from "react";
import { subagentTabs } from "./tabBar";
import { agentOf, type SessionTab, subagentTab } from "./useSessionTab";

// The tabs on the Session's chat column: the Grill, while there is one, then the chat, then one
// muted tab per Subagent in the order they started. Past four, finished Subagents wait behind a
// "+N" menu at the end. The Grill tab glows amber while a Round waits on the developer and another
// tab shows.
export function SessionTabs({
  tab,
  grill,
  waiting,
  subagents,
  onSelect,
  onClose,
}: {
  tab: SessionTab;
  grill: boolean;
  waiting: boolean;
  // The Subagents whose tabs are open.
  subagents: ReadonlyArray<SubagentSummary>;
  onSelect: (tab: SessionTab) => void;
  // Closes a Subagent's tab, by agent id. Grill and Chat can't be closed.
  onClose: (agentId: string) => void;
}) {
  const tabs: Array<{
    value: SessionTab;
    label: ReactNode;
    muted?: boolean;
    title?: string;
    onClose?: () => void;
  }> = [];
  if (grill)
    tabs.push({
      value: "grill",
      label: (
        <>
          {waiting && tab !== "grill" && (
            <span className="size-1.5 rounded-full bg-amber shadow-[0_0_8px_rgb(245_177_76/0.8)]" />
          )}
          Grill
        </>
      ),
    });
  tabs.push({ value: "chat", label: "Chat" });
  const { shown, overflow } = subagentTabs(subagents, agentOf(tab));
  for (const subagent of shown)
    tabs.push({
      ...subagentTabOf(subagent),
      muted: true,
      onClose: () => onClose(subagent.agentId),
    });
  return (
    <TabBar label="Session" value={tab} onChange={onSelect} tabs={tabs}>
      <TabOverflowMenu tabs={overflow.map(subagentTabOf)} onChange={onSelect} />
    </TabBar>
  );
}

const subagentTabOf = (subagent: SubagentSummary) => ({
  value: subagentTab(subagent.agentId),
  label: (
    <SubagentTabLabel
      description={subagent.description || subagent.agentType}
      status={subagent.status}
    />
  ),
  title: `${subagent.agentType}: ${subagent.description}`,
});
