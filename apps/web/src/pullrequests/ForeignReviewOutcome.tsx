import type { Walkthrough } from "@repo/api";
import { Callout } from "@repo/ui/Callout";
import { DateTime } from "effect";
import { PostReviewButton } from "./PostReviewButton";

const rejected = (walkthrough: Walkthrough) =>
  walkthrough.sections.some((s) => s.verdict?.kind === "rejected") ||
  walkthrough.unexplained.some((u) => u.verdict?.kind === "rejected");

// How a Reviewed Walkthrough of a Foreign PR ended: its verdicts stay in Fern, with no Session to
// go back to, and reach the PR's author only in a review the developer posts, once, while the PR is
// open.
export function ForeignReviewOutcome({
  walkthrough,
  root,
  number,
  open,
}: {
  walkthrough: Walkthrough;
  root: string;
  number: number;
  // The PR is still open, as last listed.
  open: boolean;
}) {
  if (walkthrough.review)
    return (
      <Callout
        tone="muted"
        action={
          <a
            href={walkthrough.review.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[13px] text-ice/90 hover:underline"
          >
            View on GitHub
          </a>
        }
      >
        Reviewed. You posted your review on GitHub{" "}
        {DateTime.toDateUtc(walkthrough.review.postedAt).toLocaleString(
          undefined,
          { dateStyle: "medium", timeStyle: "short" },
        )}
        .
      </Callout>
    );
  const post = (label: string) =>
    open ? (
      <PostReviewButton
        root={root}
        number={number}
        walkthroughId={walkthrough.id}
        label={label}
      />
    ) : undefined;
  if (walkthrough.reviewError)
    return (
      <Callout tone="danger" action={post("Try again")}>
        GitHub refused your review. {walkthrough.reviewError}
      </Callout>
    );
  return (
    <Callout tone="muted" action={post("Post review")}>
      {!open
        ? "Reviewed. This PR isn't open any more, so your verdicts stay in Fern."
        : rejected(walkthrough)
          ? "Reviewed. Your Rejection notes stay in Fern: nothing reaches the PR's author until you post a review."
          : "Reviewed. You approved every change. Nothing reaches the PR's author until you post a review."}
    </Callout>
  );
}
