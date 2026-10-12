import type { Walkthrough } from "@repo/api";
import { WalkthroughRow } from "@repo/ui/WalkthroughRow";
import { rowStatus } from "./review";
import { WriteWalkthroughButton } from "./WriteWalkthroughButton";

// A Session's Walkthroughs at the top of the code panel's list, newest first, with a way to ask for
// another.
export function WalkthroughList({
  sessionId,
  walkthroughs,
  current,
  onPick,
}: {
  sessionId: string;
  walkthroughs: ReadonlyArray<Walkthrough>;
  // The Walkthrough on screen.
  current: string | undefined;
  onPick: (id: string) => void;
}) {
  return (
    <div className="mb-3 space-y-0.5 border-b border-hairline pb-3">
      {walkthroughs.toReversed().map((walkthrough) => (
        <WalkthroughRow
          key={walkthrough.id}
          number={walkthrough.number}
          {...rowStatus(walkthrough)}
          active={walkthrough.id === current}
          onSelect={() => onPick(walkthrough.id)}
        />
      ))}
      <div className="px-1 pt-2">
        <WriteWalkthroughButton
          sessionId={sessionId}
          disabled={walkthroughs.some((w) => w.status === "writing")}
        />
      </div>
    </div>
  );
}
