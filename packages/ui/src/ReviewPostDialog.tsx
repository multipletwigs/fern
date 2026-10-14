import { AlertDialog } from "@base-ui/react/alert-dialog";
import { GhostButton } from "./GhostButton";
import { Pre } from "./Pre";

// Shows the developer the review Fern would post on a PR, exactly as GitHub gets it, and posts it
// only from its confirm button. Cancelling, Esc, or clicking outside closes it and posts nothing.
export function ReviewPostDialog({
  open,
  onOpenChange,
  review,
  problem,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // What GitHub gets, once Fern has worked it out: what the review says of the PR, its body as
  // written, and each line comment with where it goes.
  review:
    | {
        readonly says: string;
        readonly body: string;
        readonly comments: ReadonlyArray<{
          readonly where: string;
          readonly body: string;
        }>;
      }
    | undefined;
  // Why it can't be shown or posted, in plain words.
  problem?: string;
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-black/50 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 flex max-h-[calc(100vh-4rem)] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-[#141414] p-5 shadow-[0_1px_2px_rgb(0_0_0/0.5),0_12px_32px_rgb(0_0_0/0.55),inset_0_1px_0_rgb(255_255_255/0.08)] transition-[opacity,scale] duration-150 ease-out outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <AlertDialog.Title className="text-sm font-medium text-ink">
            Post this review on GitHub?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[13px] leading-relaxed text-muted">
            This is exactly what the PR's author will see, posted as you. Once
            it's up, Fern can't take it back.
          </AlertDialog.Description>
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
            {review === undefined ? (
              <p className="text-[13px] text-faint">
                {problem ?? "Putting the review together…"}
              </p>
            ) : (
              <>
                <p className="text-[13px] text-ink/85">{review.says}</p>
                <Pre text={review.body} />
                {review.comments.length > 0 && (
                  <>
                    <p className="mt-4 text-[13px] text-ink/85">
                      {review.comments.length === 1
                        ? "And one comment on its line:"
                        : `And ${review.comments.length} comments, each on its line:`}
                    </p>
                    {review.comments.map((comment) => (
                      <div
                        key={`${comment.where}\0${comment.body}`}
                        className="mt-2"
                      >
                        <p className="font-mono text-[11px] text-faint">
                          {comment.where}
                        </p>
                        <Pre text={comment.body} className="mt-1" />
                      </div>
                    ))}
                  </>
                )}
                {problem !== undefined && (
                  <p className="mt-3 text-[13px] text-danger/90">{problem}</p>
                )}
              </>
            )}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <GhostButton onClick={() => onOpenChange(false)}>
              Cancel
            </GhostButton>
            <GhostButton
              tone="ice"
              disabled={pending || review === undefined}
              onClick={onConfirm}
            >
              {pending ? "Posting…" : "Post review"}
            </GhostButton>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
