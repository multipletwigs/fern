import { useAtomSet } from "@effect/atom-react";
import { GhostButton } from "@repo/ui/GhostButton";
import { Cause, Exit, Option } from "effect";
import { useState } from "react";
import { walkThroughAtom } from "./atoms";
import { whyNotWalked } from "./whyNotWalked";

// Asks for a Walkthrough of a Foreign PR, at its head, from where it leaves its base. Only ever on
// the developer's say-so: Fern never walks through a PR on its own.
export function WalkThroughButton({
  root,
  number,
  label,
  disabled,
}: {
  root: string;
  number: number;
  label: string;
  disabled?: boolean;
}) {
  const walkThrough = useAtomSet(walkThroughAtom, { mode: "promiseExit" });
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string>();
  return (
    <div className="space-y-1.5">
      <GhostButton
        tone="ice"
        disabled={disabled || starting}
        onClick={async () => {
          setStarting(true);
          const exit = await walkThrough({
            params: { number },
            payload: { root },
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
        {starting ? "Starting…" : label}
      </GhostButton>
      {notice && <p className="max-w-64 text-xs text-faint">{notice}</p>}
    </div>
  );
}
