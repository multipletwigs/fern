import { useAtomSet } from "@effect/atom-react";
import { GhostButton } from "@repo/ui/GhostButton";
import { Cause, Exit, Option } from "effect";
import { useState } from "react";
import { terminalOpenAtom } from "../terminal/atoms";
import { tryItAtom } from "./atoms";
import { whyNotTried } from "./whyNotTried";

// Try it: checks the open Foreign PR's head out in a worktree of its own, or moves the one it has
// to the head, then shows its Terminal there. The developer's checkout is never touched.
export function TryItButton({
  root,
  number,
  terminalKey,
  onTried,
}: {
  root: string;
  number: number;
  // The PR's Terminal, as `terminalKeyOf` keys it.
  terminalKey: string;
  // Told once the worktree is checked out, for the list to show it.
  onTried: () => void;
}) {
  const tryIt = useAtomSet(tryItAtom, { mode: "promiseExit" });
  const showTerminal = useAtomSet(terminalOpenAtom(terminalKey));
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string>();
  return (
    <div className="relative">
      <GhostButton
        tone="ice"
        disabled={starting}
        onClick={async () => {
          setStarting(true);
          const exit = await tryIt({ params: { number }, payload: { root } });
          setStarting(false);
          if (Exit.isSuccess(exit)) {
            setNotice(undefined);
            showTerminal(true);
            onTried();
            return;
          }
          setNotice(
            whyNotTried(
              Option.getOrUndefined(Cause.findErrorOption(exit.cause)),
            ),
          );
        }}
      >
        {starting ? "Checking out…" : "Try it"}
      </GhostButton>
      {notice && (
        // Clicked away.
        <button
          type="button"
          role="status"
          onClick={() => setNotice(undefined)}
          className="absolute top-full right-0 z-20 mt-1.5 w-72 rounded-lg bg-[#141414] p-2.5 text-left text-xs leading-relaxed text-muted shadow-panel"
        >
          {notice}
        </button>
      )}
    </div>
  );
}
