import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { SubagentSummary } from "@repo/api";
import { AsyncResult } from "effect/reactivity";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { roundsAtom } from "../grill/atoms";
import { reviewSeenAtom, reviewShownAtom } from "../review/atoms";
import { waitingCount } from "../review/queue";
import { walkthroughsAtom } from "../walkthrough/atoms";
import { closeSubagentAtom, reopenSubagentAtom, subagentsAtom } from "./atoms";

import {
  agentOf,
  preferredTab,
  type SessionTab,
  subagentTab,
} from "./sessionTab";

export { agentOf, type SessionTab, subagentTab };

const NO_SUBAGENTS: ReadonlyArray<SubagentSummary> = [];

// Which tab of the Session shows: the Grill while a Round is open, the chat otherwise, unless the
// developer switched. Their switch holds until a Round opens or closes. Opening the Review tab from
// outside it, as from the status above the composer or the Pull requests page, switches to it
// until they pick a tab or a Round opens or closes, even when the Session is drawn only
// afterwards. A new Subagent never takes the selection. A Subagent tab the developer closed stays
// out of the bar, for the Session, until they open it again from its row in the chat.
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
  const round = open?.id;
  // Asked for from outside since the developer last picked a tab, whether or not the Session
  // was drawn then, and the Round open when this tab first saw the ask, once its Rounds are in.
  const shown = useAtomValue(reviewShownAtom(sessionId));
  const [seen, setSeen] = useAtom(reviewSeenAtom(sessionId));
  const [askedAt, setAskedAt] = useState<{
    shown: number;
    round: string | undefined;
  }>();
  const pending = shown !== seen;
  if (pending && rounds !== undefined && askedAt?.shown !== shown)
    setAskedAt({ shown, round });
  const asking = pending && askedAt?.shown === shown;
  const askedRound = askedAt?.round;
  // A Round opening or closing since spends the ask, as it does the developer's own pick.
  useEffect(() => {
    if (asking && askedRound !== round) setSeen(shown);
  }, [asking, askedRound, round, setSeen, shown]);
  const preferred = preferredTab({
    open: round,
    chosen,
    asked: asking ? { round: askedRound } : undefined,
  });
  const select = useCallback(
    (next: SessionTab) => {
      setSeen(shown);
      setChosen({ round, tab: next });
    },
    [round, setSeen, shown],
  );
  const walkthroughs = useAtomValue(walkthroughsAtom(sessionId));
  const reviewWaiting = AsyncResult.isSuccess(walkthroughs)
    ? waitingCount(walkthroughs.value)
    : 0;
  // Selects a Subagent's tab, reopening it first if it was closed. Every chat row holds it, so it
  // reads the list through a ref rather than change with each list update.
  const listedRef = useRef(all);
  useLayoutEffect(() => {
    listedRef.current = all;
  }, [all]);
  const openSubagent = useCallback(
    (agentId: string) => {
      if (listedRef.current.some((s) => s.agentId === agentId && s.closed))
        reopenSubagent({ params: { sessionId, agentId } });
      select(subagentTab(agentId));
    },
    [reopenSubagent, select, sessionId],
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
    // Items across the Session's Walkthroughs still waiting on a verdict.
    reviewWaiting,
    subagents,
    tab: (preferred === "grill" && !grill) || missing ? "chat" : preferred,
    select,
    openSubagent,
    close,
  };
}
