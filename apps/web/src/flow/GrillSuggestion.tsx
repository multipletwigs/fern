import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { GrillSuggestionCard } from "@repo/ui/GrillSuggestionCard";
import { Exit } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { dismissSuggestionAtom, flowStartAtom, startGrillAtom } from "./atoms";

// A `suggest_grill` call in the transcript, as its Grill suggestion: starting the Grill from it,
// or turning it down for now.
export function GrillSuggestion({
  sessionId,
  id,
}: {
  sessionId: string;
  id: string;
}) {
  const result = useAtomValue(flowStartAtom(sessionId));
  const start = useAtomSet(startGrillAtom, { mode: "promiseExit" });
  const dismiss = useAtomSet(dismissSuggestionAtom, { mode: "promiseExit" });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const state = AsyncResult.isSuccess(result) ? result.value : null;
  const suggestion = state?.suggestions.find((s) => s.id === id);
  if (!state || !suggestion) return null;

  const decide = async (run: () => Promise<Exit.Exit<unknown, unknown>>) => {
    setPending(true);
    const exit = await run();
    setPending(false);
    setFailed(Exit.isFailure(exit));
  };
  return (
    <GrillSuggestionCard
      what={suggestion.what}
      status={suggestion.status}
      flowStarted={state.started}
      pending={pending}
      failed={failed}
      onStart={(what) =>
        void decide(() =>
          start({
            params: { session: sessionId },
            payload: { what, suggestion: id },
          }),
        )
      }
      onDismiss={() => void decide(() => dismiss({ params: { id } }))}
    />
  );
}
