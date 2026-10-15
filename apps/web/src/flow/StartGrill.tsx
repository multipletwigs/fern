import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { StartGrillButton } from "@repo/ui/StartGrillButton";
import { Exit } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { flowStartAtom, startGrillAtom } from "./atoms";

// The top bar's way into the Flow for a Session still a chat, without waiting for a suggestion.
export function StartGrill({ sessionId }: { sessionId: string }) {
  const result = useAtomValue(flowStartAtom(sessionId));
  const start = useAtomSet(startGrillAtom, { mode: "promiseExit" });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const state = AsyncResult.isSuccess(result) ? result.value : null;
  if (!state || state.started) return null;
  return (
    <StartGrillButton
      pending={pending}
      failed={failed}
      onStart={(what) =>
        void (async () => {
          setPending(true);
          const exit = await start({
            params: { session: sessionId },
            payload: { what },
          });
          setPending(false);
          setFailed(Exit.isFailure(exit));
        })()
      }
    />
  );
}
