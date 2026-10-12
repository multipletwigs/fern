import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { roundsAtom } from "../grill/atoms";

// A tab on the Session's chat column. Named by a string, so a tab can later name a Subagent.
export type SessionTab = "grill" | "chat";

// Which tab of the Session shows: the Grill while a Round is open, the chat otherwise, unless the
// developer switched. Their switch holds until a Round opens or closes.
export function useSessionTab(sessionId: string) {
  const result = useAtomValue(roundsAtom(sessionId));
  const rounds = AsyncResult.isSuccess(result) ? result.value : undefined;
  const open = rounds?.open;
  // Whether there is a Grill to switch to: an open Round, or Decisions settled.
  const grill = open !== undefined || (rounds?.decisions.length ?? 0) > 0;
  const [chosen, setChosen] = useState<{
    round: string | undefined;
    tab: SessionTab;
  }>();
  const preferred: SessionTab =
    chosen && chosen.round === open?.id ? chosen.tab : open ? "grill" : "chat";
  return {
    rounds,
    grill,
    tab: preferred === "grill" && !grill ? "chat" : preferred,
    select: (next: SessionTab) => setChosen({ round: open?.id, tab: next }),
  };
}
