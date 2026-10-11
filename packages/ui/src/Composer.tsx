import { ArrowUpIcon, StopIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";
import { type KeyboardEvent, useState } from "react";
import { Loader } from "./Loader";

// The message box under a transcript. Enter sends, Shift+Enter adds a line. While a turn runs it
// offers Stop instead of Send.
export function Composer({
  placeholder,
  disabled = false,
  running,
  notice,
  onSend,
  onStop,
}: {
  placeholder: string;
  disabled?: boolean;
  running: boolean;
  // Shown above the box, e.g. why it's disabled or why the last turn failed.
  notice?: string;
  // Resolves true once the message is accepted, which clears the box.
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const canSend = !disabled && !running && !sending && text.trim() !== "";

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    if (await onSend(text.trim())) setText("");
    setSending(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    void send();
  };

  return (
    <div className="mx-auto w-full max-w-[720px] shrink-0 px-6 pb-5">
      {notice && <p className="mb-2 px-1 text-xs text-muted">{notice}</p>}
      <div
        className={clsx(
          "flex items-end gap-2 rounded-2xl border bg-white/[0.035] p-2 pl-4 shadow-[0_8px_30px_rgb(0_0_0/0.4)] transition-colors focus-within:border-ice/25",
          disabled ? "border-hairline opacity-60" : "border-white/10",
        )}
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          className="max-h-60 min-h-9 flex-1 resize-none bg-transparent py-2 text-[15px] leading-6 text-ink outline-none [field-sizing:content] placeholder:text-faint disabled:cursor-not-allowed"
        />
        {running ? (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-xs text-muted">
              <Loader variant="orbit" className="text-sm text-ink" />
              Working
            </span>
            <button
              type="button"
              onClick={onStop}
              title="Stop"
              className="flex size-9 items-center justify-center rounded-xl bg-white/10 text-ink transition-colors hover:bg-white/15"
            >
              <StopIcon weight="fill" className="size-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            title="Send"
            className="flex size-9 items-center justify-center rounded-xl bg-ink text-canvas transition-opacity hover:opacity-90 disabled:opacity-20"
          >
            {sending ? (
              <Loader className="text-sm" />
            ) : (
              <ArrowUpIcon weight="bold" className="size-4" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
