import { useAtomSet } from "@effect/atom-react";
import type { Walkthrough } from "@repo/api";
import { Callout } from "@repo/ui/Callout";
import { GhostButton } from "@repo/ui/GhostButton";
import { redirectAtom } from "./atoms";

const rejected = (walkthrough: Walkthrough) =>
  walkthrough.sections.some((s) => s.verdict?.kind === "rejected") ||
  walkthrough.unexplained.some((u) => u.verdict?.kind === "rejected");

// How a Reviewed Walkthrough ended: all approved, or its Rejection notes sent back to the Session.
export function ReviewOutcome({ walkthrough }: { walkthrough: Walkthrough }) {
  const redirect = useAtomSet(redirectAtom);
  if (walkthrough.redirectError)
    return (
      <Callout
        tone="danger"
        action={
          <GhostButton
            onClick={() => redirect({ params: { id: walkthrough.id } })}
          >
            Send again
          </GhostButton>
        }
      >
        Your Rejection notes didn't reach the Session.{" "}
        {walkthrough.redirectError}
      </Callout>
    );
  if (walkthrough.redirectSentAt)
    return (
      <Callout tone="muted">
        Reviewed. Your Rejection notes went back to the Session, and Claude is
        on them.
      </Callout>
    );
  return (
    <Callout tone="muted">
      {rejected(walkthrough)
        ? "Reviewed. Sending your Rejection notes to the Session…"
        : "Reviewed. You approved every change."}
    </Callout>
  );
}
