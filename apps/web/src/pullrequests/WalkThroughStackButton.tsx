import { useAtomSet } from "@effect/atom-react";
import type { PrListState } from "@repo/api";
import { GhostButton } from "@repo/ui/GhostButton";
import { Cause, Exit, Option } from "effect";
import { useState } from "react";
import { walkThroughStackAtom } from "./atoms";
import { whyNotWalked } from "./whyNotWalked";

// Asks for Walkthroughs of a Stack's Foreign PRs, bottom first, one at a time, leaving out those up
// to date. Only on the developer's say-so, and only while some PR in it would get one.
export function WalkThroughStackButton({
  root,
  id,
  state,
  disabled,
}: {
  root: string;
  // The Stack's id on GitHub.
  id: number;
  // Which PRs the page lists, so the Stack is walked through as it shows.
  state: PrListState;
  disabled: boolean;
}) {
  const walkThrough = useAtomSet(walkThroughStackAtom, {
    mode: "promiseExit",
  });
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string>();
  return (
    <span className="flex shrink-0 items-center gap-2">
      {notice && <span className="max-w-64 truncate">{notice}</span>}
      <GhostButton
        tone="ice"
        disabled={disabled || starting}
        onClick={async () => {
          setStarting(true);
          const exit = await walkThrough({
            params: { id },
            payload: { root, state },
          });
          setStarting(false);
          setNotice(
            Exit.isSuccess(exit)
              ? undefined
              : whyNotWalked(
                  Option.getOrUndefined(Cause.findErrorOption(exit.cause)),
                ),
          );
        }}
      >
        {starting ? "Starting…" : "Walk through Stack"}
      </GhostButton>
    </span>
  );
}
