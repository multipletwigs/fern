import { useAtomSet } from "@effect/atom-react";
import type { PrReview } from "@repo/api";
import { GhostButton } from "@repo/ui/GhostButton";
import { ReviewPostDialog } from "@repo/ui/ReviewPostDialog";
import { Cause, Exit, Option } from "effect";
import { useState } from "react";
import { postReviewAtom, reviewPreviewAtom } from "./atoms";
import { reviewPreview } from "./reviewPreview";
import { whyNotPosted } from "./whyNotPosted";

const errorOf = (cause: Cause.Cause<unknown>) =>
  whyNotPosted(Option.getOrUndefined(Cause.findErrorOption(cause)));

// Posts a Reviewed Foreign PR Walkthrough's review on GitHub, only from the confirm in its dialog,
// which first shows exactly what GitHub would get. Nothing leaves Fern before that.
export function PostReviewButton({
  root,
  number,
  walkthroughId,
  label,
}: {
  root: string;
  number: number;
  walkthroughId: string;
  label: string;
}) {
  const ask = useAtomSet(reviewPreviewAtom, { mode: "promiseExit" });
  const post = useAtomSet(postReviewAtom, { mode: "promiseExit" });
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<PrReview>();
  const [problem, setProblem] = useState<string>();
  const [pending, setPending] = useState(false);

  const show = async () => {
    setOpen(true);
    setReview(undefined);
    setProblem(undefined);
    const exit = await ask({
      params: { number },
      query: { root, walkthrough: walkthroughId },
    });
    if (Exit.isSuccess(exit)) setReview(exit.value);
    else setProblem(errorOf(exit.cause));
  };

  const confirm = async () => {
    if (review === undefined) return;
    setPending(true);
    setProblem(undefined);
    const exit = await post({
      params: { number },
      payload: { root, walkthrough: review.walkthrough },
    });
    setPending(false);
    if (Exit.isSuccess(exit)) setOpen(false);
    else setProblem(errorOf(exit.cause));
  };

  return (
    <>
      <GhostButton tone="ice" onClick={() => void show()}>
        {label}
      </GhostButton>
      <ReviewPostDialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
        review={review && reviewPreview(review)}
        problem={problem}
        pending={pending}
        onConfirm={() => void confirm()}
      />
    </>
  );
}
