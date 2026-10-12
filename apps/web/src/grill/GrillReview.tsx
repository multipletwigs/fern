import { KeyHint } from "@repo/ui/KeyHint";
import { Loader } from "@repo/ui/Loader";

// The end of a Round: every question answered, waiting for the developer to send the answers.
export function GrillReview({
  total,
  sending,
  failure,
  onSend,
}: {
  total: number;
  sending: boolean;
  failure: string | undefined;
  onSend: () => void;
}) {
  return (
    <div className="animate-fade-in">
      <p className="font-mono text-[11px] tracking-wide text-ice/80 uppercase">
        All answered
      </p>
      <h2 className="mt-2 text-[26px] leading-9 font-medium text-ink">
        Send your {total === 1 ? "answer" : `${total} answers`} to Claude?
      </h2>
      <p className="mt-2 text-[15px] leading-6 text-ink/60">
        Each becomes a Decision for this Project, and they go back to the
        Session in one message. Click any answer above to change it first.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          disabled={sending}
          onClick={onSend}
          className="flex h-10 items-center gap-2.5 rounded-xl bg-ink px-4 text-[14px] font-medium text-canvas transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
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
      {failure && <p className="mt-3 text-[13px] text-danger/85">{failure}</p>}
    </div>
  );
}
