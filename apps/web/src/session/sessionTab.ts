// A tab on the Session's chat column: the Grill, the chat, the Review tab, or one of its Subagents
// by agent id.
export type SessionTab = "grill" | "chat" | "review" | `agent:${string}`;

export const subagentTab = (agentId: string): SessionTab => `agent:${agentId}`;

// The Subagent a tab shows, if it shows one.
export const agentOf = (tab: SessionTab) =>
  tab.startsWith("agent:") ? tab.slice("agent:".length) : undefined;

// Which tab of the Session shows: the Grill while a Round is open, the chat otherwise, unless the
// developer picked one, which holds until a Round opens or closes. The Review tab, once something
// outside it asks for it, holds the same way: a Round opening after the ask brings the Grill to the
// front, as a Round opening always does.
export const preferredTab = ({
  open,
  chosen,
  asked,
}: {
  // The open Round's id.
  readonly open: string | undefined;
  // The developer's pick, and the Round open when they picked it.
  readonly chosen:
    | { readonly round: string | undefined; readonly tab: SessionTab }
    | undefined;
  // The Round open when the Review tab was asked for, while that ask stands.
  readonly asked: { readonly round: string | undefined } | undefined;
}): SessionTab => {
  if (asked !== undefined && asked.round === open) return "review";
  if (chosen !== undefined && chosen.round === open) return chosen.tab;
  return open !== undefined ? "grill" : "chat";
};
