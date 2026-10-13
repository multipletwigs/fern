import type { SubagentSummary } from "@repo/api";
import { AgentsMenu } from "@repo/ui/AgentsMenu";
import { SubagentTabLabel } from "@repo/ui/SubagentTabLabel";
import { TabBar, type TabBarSlot, type TabBarTab } from "@repo/ui/TabBar";
import { agentsMenu } from "./tabBar";
import { agentOf, type SessionTab, subagentTab } from "./useSessionTab";

// The tabs on the Session's chat column: the Grill, while there is one, then the chat, the Review
// tab, always there, then one Agents menu holding every open Subagent. The Subagent picked from it
// shows as one more tab after the menu. The Grill tab glows amber while a Round waits on the
// developer and another tab shows; the Review tab counts the items still waiting on a verdict.
export function SessionTabs({
  tab,
  grill,
  waiting,
  reviewWaiting,
  subagents,
  onSelect,
  onClose,
}: {
  tab: SessionTab;
  grill: boolean;
  waiting: boolean;
  reviewWaiting: number;
  // The Subagents whose tabs are open.
  subagents: ReadonlyArray<SubagentSummary>;
  onSelect: (tab: SessionTab) => void;
  // Closes a Subagent's tab, by agent id. Grill and Chat can't be closed.
  onClose: (agentId: string) => void;
}) {
  const tabs: Array<TabBarTab<SessionTab> | TabBarSlot> = [];
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
  tabs.push({
    value: "review",
    label: (
      <>
        Review
        {reviewWaiting > 0 && (
          <span className="rounded-full bg-amber/[0.14] px-1.5 font-mono text-[10px] leading-4 text-amber tabular-nums">
            {reviewWaiting}
          </span>
        )}
      </>
    ),
    title:
      reviewWaiting > 0
        ? `${reviewWaiting} waiting on your verdict`
        : undefined,
  });
  const { running, active } = agentsMenu(subagents, agentOf(tab));
  tabs.push({
    slot: "agents",
    element: (
      <AgentsMenu
        agents={subagents.map((subagent) => ({
          value: subagentTab(subagent.agentId),
          description: subagent.description || subagent.agentType,
          agentType: subagent.agentType,
          status: subagent.status,
        }))}
        running={running}
        value={tab}
        onChange={onSelect}
        onClose={(value) => {
          const agentId = agentOf(value);
          if (agentId !== undefined) onClose(agentId);
        }}
      />
    ),
  });
  if (active)
    tabs.push({
      value: subagentTab(active.agentId),
      label: (
        <SubagentTabLabel
          description={active.description || active.agentType}
          status={active.status}
        />
      ),
      title: `${active.agentType}: ${active.description}`,
      onClose: () => onClose(active.agentId),
    });
  return <TabBar label="Session" value={tab} onChange={onSelect} tabs={tabs} />;
}
