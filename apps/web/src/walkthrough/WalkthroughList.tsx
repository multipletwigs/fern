import type { Walkthrough } from "@repo/api";
import { WalkthroughRow } from "@repo/ui/WalkthroughRow";
import { openItems } from "./review";
import { WriteWalkthroughButton } from "./WriteWalkthroughButton";

const rowStatus = (
  walkthrough: Walkthrough,
): { status: string; tone: "amber" | "writing" | "danger" | "muted" } => {
  if (walkthrough.status === "writing")
    return { status: "Writing", tone: "writing" };
  if (walkthrough.status === "failed")
    return { status: "Failed", tone: "danger" };
  if (walkthrough.redirectError) return { status: "Not sent", tone: "danger" };
  if (walkthrough.reviewedAt) return { status: "Reviewed", tone: "muted" };
  return { status: `${openItems(walkthrough)} to review`, tone: "amber" };
};

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
    <div className="mb-3 space-y-px border-b border-hairline pb-3">
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
