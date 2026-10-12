import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { SubagentSummary } from "@repo/api";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useMemo, useState } from "react";
import { roundsAtom } from "../grill/atoms";
import { closeSubagentAtom, reopenSubagentAtom, subagentsAtom } from "./atoms";

// A tab on the Session's chat column: the Grill, the chat, or one of its Subagents by agent id.
export type SessionTab = "grill" | "chat" | `agent:${string}`;

export const subagentTab = (agentId: string): SessionTab => `agent:${agentId}`;

// The Subagent a tab shows, if it shows one.
export const agentOf = (tab: SessionTab) =>
  tab.startsWith("agent:") ? tab.slice("agent:".length) : undefined;

const NO_SUBAGENTS: ReadonlyArray<SubagentSummary> = [];

// Which tab of the Session shows: the Grill while a Round is open, the chat otherwise, unless the
// developer switched. Their switch holds until a Round opens or closes. A new Subagent never takes
// the selection. A Subagent tab the developer closed stays out of the bar, for the Session, until
// they open it again from its row in the chat.
export function useSessionTab(sessionId: string) {
  const result = useAtomValue(roundsAtom(sessionId));
  const rounds = AsyncResult.isSuccess(result) ? result.value : undefined;
  const listed = useAtomValue(subagentsAtom(sessionId));
  const all = AsyncResult.isSuccess(listed) ? listed.value : NO_SUBAGENTS;
  const subagents = useMemo(() => all.filter((s) => !s.closed), [all]);
  const closeSubagent = useAtomSet(closeSubagentAtom);
  const reopenSubagent = useAtomSet(reopenSubagentAtom);
  const open = rounds?.open;
  // Whether there is a Grill to switch to: an open Round, or Decisions settled.
  const grill = open !== undefined || (rounds?.decisions.length ?? 0) > 0;
  const [chosen, setChosen] = useState<{
    round: string | undefined;
    tab: SessionTab;
  }>();
  const preferred: SessionTab =
    chosen && chosen.round === open?.id ? chosen.tab : open ? "grill" : "chat";
  const round = open?.id;
  const select = useCallback(
    (next: SessionTab) => setChosen({ round, tab: next }),
    [round],
  );
  // Selects a Subagent's tab, reopening it first if it was closed.
  const openSubagent = useCallback(
    (agentId: string) => {
      if (all.some((s) => s.agentId === agentId && s.closed))
        reopenSubagent({ params: { sessionId, agentId } });
      select(subagentTab(agentId));
    },
    [all, reopenSubagent, select, sessionId],
  );
  // Closes a Subagent's tab; the chat shows in its place if it was showing.
  const close = useCallback(
    (agentId: string) => {
      closeSubagent({ params: { sessionId, agentId } });
      if (agentOf(preferred) === agentId) select("chat");
    },
    [closeSubagent, preferred, select, sessionId],
  );
  const agent = agentOf(preferred);
  // A Subagent the Session doesn't list, or whose tab is closed, once the list is in, has nothing
  // to show.
  const missing =
    agent !== undefined &&
    AsyncResult.isSuccess(listed) &&
    !subagents.some((s) => s.agentId === agent);
  return {
    rounds,
    grill,
    subagents,
    tab: (preferred === "grill" && !grill) || missing ? "chat" : preferred,
    select,
    openSubagent,
    close,
  };
}
