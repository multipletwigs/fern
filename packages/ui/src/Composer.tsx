import { ArrowUpIcon, StopIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";
import { type KeyboardEvent, useState } from "react";
import { Loader } from "./Loader";

// A button lifted off the box the way the active sidebar tab is lifted off the sidebar.
const raised =
  "flex size-8 items-center justify-center rounded-lg bg-white/[0.09] text-ink shadow-[0_1px_2px_rgb(0_0_0/0.5),inset_0_1px_0_rgb(255_255_255/0.08)] transition-[background-color,opacity] hover:bg-white/[0.14] disabled:opacity-30 disabled:hover:bg-white/[0.09]";

// The message box under a transcript, a raised surface like the active sidebar tab. Enter sends,
// Shift+Enter adds a line. While a turn runs it offers Stop instead of Send.
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
          "flex flex-col rounded-2xl bg-white/[0.06] shadow-[0_1px_2px_rgb(0_0_0/0.5),0_10px_30px_rgb(0_0_0/0.35),inset_0_1px_0_rgb(255_255_255/0.06)] transition-colors focus-within:bg-white/[0.08]",
          disabled && "opacity-60",
        )}
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          rows={3}
          className="max-h-72 min-h-[84px] resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-6 text-ink outline-none [field-sizing:content] placeholder:text-faint disabled:cursor-not-allowed"
        />
        <div className="flex justify-end p-2 pt-0">
          {running ? (
            <button
              type="button"
              onClick={onStop}
              title="Stop"
              className={raised}
            >
              <StopIcon weight="fill" className="size-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              title="Send"
              className={raised}
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
    </div>
  );
}
