import type { PrReview, PrReviewEvent } from "@repo/api";

const SAYS: Record<PrReviewEvent, string> = {
  APPROVE: "It approves the PR.",
  REQUEST_CHANGES: "It requests changes.",
  COMMENT:
    "It's a comment, as GitHub won't let you approve or request changes on your own PR.",
};

// A Foreign PR's review as the confirm dialog shows it: what it says of the PR, its body as GitHub
// gets it, and where each line comment goes.
export const reviewPreview = (review: PrReview) => ({
  says: SAYS[review.event],
  body: review.body,
  comments: review.comments.map((comment) => ({
    where: `${comment.path}, line ${comment.line}${comment.side === "LEFT" ? ", as it was before the PR removed it" : ""}`,
    body: comment.body,
  })),
});
