import type { Walkthrough } from "@repo/api";
import { Callout } from "@repo/ui/Callout";

const rejected = (walkthrough: Walkthrough) =>
  walkthrough.sections.some((s) => s.verdict?.kind === "rejected") ||
  walkthrough.unexplained.some((u) => u.verdict?.kind === "rejected");

// How a Reviewed Walkthrough of a Foreign PR ended: its verdicts stay in Fern, with no Session to
// go back to, and reach the PR's author only in a review the developer posts.
export function ForeignReviewOutcome({
  walkthrough,
}: {
  walkthrough: Walkthrough;
}) {
  return (
    <Callout tone="muted">
      {rejected(walkthrough)
        ? "Reviewed. Your Rejection notes stay in Fern: nothing reaches the PR's author until you post a review."
        : "Reviewed. You approved every change. Nothing reaches the PR's author until you post a review."}
    </Callout>
  );
}
