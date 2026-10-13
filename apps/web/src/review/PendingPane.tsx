import type { Walkthrough } from "@repo/api";
import { Callout } from "@repo/ui/Callout";
import { Loader } from "@repo/ui/Loader";
import { ReviewPane } from "@repo/ui/ReviewPane";
import { WriteWalkthroughButton } from "../walkthrough/WriteWalkthroughButton";

// A Walkthrough with nothing to review yet, open in the Review tab: Claude is still writing it, or
// writing it failed, with a way to try again.
export function PendingPane({ walkthrough }: { walkthrough: Walkthrough }) {
  return (
    <ReviewPane
      eyebrow={`Walkthrough ${walkthrough.number}`}
      title={
        walkthrough.status === "writing"
          ? "Being written"
          : "Couldn't be written"
      }
    >
      {walkthrough.status === "writing" ? (
        <Callout tone="muted">
          <span className="flex items-center gap-2">
            <Loader className="text-base text-muted" label="Writing" />
            Claude is writing this Walkthrough from a fork of the Session. Its
            Sections show here once it's done.
          </span>
        </Callout>
      ) : (
        <Callout
          tone="danger"
          action={
            <WriteWalkthroughButton
              sessionId={walkthrough.sessionId}
              label="Try again"
            />
          }
        >
          Couldn't write this Walkthrough. {walkthrough.error}
        </Callout>
      )}
    </ReviewPane>
  );
}
