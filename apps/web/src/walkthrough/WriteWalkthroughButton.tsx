import { useAtomSet } from "@effect/atom-react";
import { GhostButton } from "@repo/ui/GhostButton";
import { Cause, Exit, Option } from "effect";
import { useState } from "react";
import { writeWalkthroughAtom } from "./atoms";

const failureNotice = (tag: string | undefined) => {
  switch (tag) {
    case "NothingToReview":
      return "Nothing changed since the last Walkthrough.";
    case "WalkthroughInProgress":
      return "A Walkthrough is being written already.";
    default:
      return "Couldn't start a Walkthrough. Is this folder in a git repository?";
  }
};

// Asks for a Walkthrough of what changed since the last one, without waiting for a turn to end.
export function WriteWalkthroughButton({
  sessionId,
  label = "Write a Walkthrough",
  disabled,
}: {
  sessionId: string;
  label?: string;
  disabled?: boolean;
}) {
  const write = useAtomSet(writeWalkthroughAtom, { mode: "promiseExit" });
  const [notice, setNotice] = useState<string>();
  return (
    <div className="space-y-1.5">
      <GhostButton
        disabled={disabled}
        onClick={async () => {
          const exit = await write({ payload: { session: sessionId } });
          setNotice(
            Exit.isSuccess(exit)
              ? undefined
              : failureNotice(
                  Option.getOrUndefined(Cause.findErrorOption(exit.cause))
                    ?._tag,
                ),
          );
        }}
      >
        {label}
      </GhostButton>
      {notice && <p className="text-xs text-faint">{notice}</p>}
    </div>
  );
}
