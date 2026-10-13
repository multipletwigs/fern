import { KeyHint } from "@repo/ui/KeyHint";
import { Loader } from "@repo/ui/Loader";

// The end of a Round, after its last question: the answers waiting for the developer to send them.
// Reached with questions still `open`, it sends the developer back to the next one instead.
export function GrillReview({
  total,
  open,
  sending,
  failure,
  onSend,
  onNextOpen,
}: {
  total: number;
  open: number;
  sending: boolean;
  failure: string | undefined;
  onSend: () => void;
  onNextOpen: () => void;
}) {
  const button =
    "flex h-10 items-center gap-2.5 rounded-xl bg-ink px-4 text-[14px] font-medium text-canvas transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-50";
  return (
    <div className="mx-auto flex min-h-full max-w-[680px] flex-col justify-center px-10 py-10">
      {open > 0 ? (
        <>
          <p className="font-mono text-[11px] tracking-wide text-amber/80 uppercase">
            {open} still open
          </p>
          <h2 className="mt-2 text-[26px] leading-9 font-medium text-ink">
            Answer {open === 1 ? "the last question" : `the other ${open}`}{" "}
            before sending
          </h2>
          <p className="mt-2 text-[15px] leading-6 text-ink/60">
            The questions without a check on the left are still open.
          </p>
          <div className="mt-6">
            <button type="button" onClick={onNextOpen} className={button}>
              Next open question
              <span className="font-mono text-[11px] opacity-60">↵</span>
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="font-mono text-[11px] tracking-wide text-ice/80 uppercase">
            All answered
          </p>
          <h2 className="mt-2 text-[26px] leading-9 font-medium text-ink">
            Send your {total === 1 ? "answer" : `${total} answers`} to Claude?
          </h2>
          <p className="mt-2 text-[15px] leading-6 text-ink/60">
            Each becomes a Decision for this Project, and they go back to the
            Session in one message. Pick any question on the left to change its
            answer first.
          </p>
          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              disabled={sending}
              onClick={onSend}
              className={button}
            >
              {sending ? (
                <Loader label="Sending" className="text-sm" />
              ) : (
                "Send answers"
              )}
              <span className="font-mono text-[11px] opacity-60">↵</span>
            </button>
            <span className="flex items-center gap-1.5 text-[12px] text-faint">
              <KeyHint>←</KeyHint> back
            </span>
          </div>
          {failure && (
            <p className="mt-3 text-[13px] text-danger/85">{failure}</p>
          )}
        </>
      )}
    </div>
  );
}
