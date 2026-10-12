import { useAtomValue } from "@effect/atom-react";
import type { SubagentSummary } from "@repo/api";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useState } from "react";
import { roundsAtom } from "../grill/atoms";
import { subagentsAtom } from "./atoms";

// A tab on the Session's chat column: the Grill, the chat, or one of its Subagents by agent id.
export type SessionTab = "grill" | "chat" | `agent:${string}`;

export const subagentTab = (agentId: string): SessionTab => `agent:${agentId}`;

// The Subagent a tab shows, if it shows one.
export const agentOf = (tab: SessionTab) =>
  tab.startsWith("agent:") ? tab.slice("agent:".length) : undefined;

const NO_SUBAGENTS: ReadonlyArray<SubagentSummary> = [];

// Which tab of the Session shows: the Grill while a Round is open, the chat otherwise, unless the
// developer switched. Their switch holds until a Round opens or closes. A new Subagent never takes
// the selection.
export function useSessionTab(sessionId: string) {
  const result = useAtomValue(roundsAtom(sessionId));
  const rounds = AsyncResult.isSuccess(result) ? result.value : undefined;
  const listed = useAtomValue(subagentsAtom(sessionId));
  const subagents = AsyncResult.isSuccess(listed) ? listed.value : NO_SUBAGENTS;
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
  const agent = agentOf(preferred);
  // A Subagent the Session doesn't list, once the list is in, has nothing to show.
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
  };
}
