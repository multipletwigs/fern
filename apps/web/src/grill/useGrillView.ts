import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { roundsAtom } from "./atoms";

export type SessionView = "grill" | "transcript";

// Which of the Session's views shows: the Grill while a Round is open, the transcript otherwise,
// unless the developer switched. Their switch holds until a Round opens or closes.
export function useGrillView(sessionId: string) {
  const result = useAtomValue(roundsAtom(sessionId));
  const rounds = AsyncResult.isSuccess(result) ? result.value : undefined;
  const open = rounds?.open;
  const [chosen, setChosen] = useState<{
    round: string | undefined;
    view: SessionView;
  }>();
  const view: SessionView =
    chosen && chosen.round === open?.id
      ? chosen.view
      : open
        ? "grill"
        : "transcript";
  return {
    rounds,
    view,
    // Whether there is a Grill to switch to: an open Round, or Decisions settled.
    available: open !== undefined || (rounds?.decisions.length ?? 0) > 0,
    setView: (next: SessionView) => setChosen({ round: open?.id, view: next }),
  };
}
