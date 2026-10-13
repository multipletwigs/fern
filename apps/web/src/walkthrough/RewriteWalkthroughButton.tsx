import { useAtomSet } from "@effect/atom-react";
import { GhostButton } from "@repo/ui/GhostButton";
import { Exit } from "effect";
import { useState } from "react";
import { rewriteWalkthroughAtom } from "./atoms";

// Writes a PR's Walkthrough that couldn't be written again, of the same change: the Stack can't
// Land until it's written and Reviewed.
export function RewriteWalkthroughButton({
  walkthroughId,
}: {
  walkthroughId: string;
}) {
  const rewrite = useAtomSet(rewriteWalkthroughAtom, { mode: "promiseExit" });
  const [failed, setFailed] = useState(false);
  return (
    <div className="space-y-1.5">
      <GhostButton
        onClick={async () => {
          const exit = await rewrite({ params: { id: walkthroughId } });
          setFailed(Exit.isFailure(exit));
        }}
      >
        Try again
      </GhostButton>
      {failed && (
        <p className="text-xs text-faint">Couldn't write it again.</p>
      )}
    </div>
  );
}
