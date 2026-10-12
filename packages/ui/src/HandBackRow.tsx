import { ArrowBendDownLeftIcon, ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Expandable } from "./Expandable";
import { Markdown } from "./Markdown";

// A Subagent's Hand-back as the Session received it: collapsed to who handed back, expanding to
// the text. Given `onOpen`, it trails a button that opens the Subagent.
export function HandBackRow({
  agentType,
  text,
  onOpen,
}: {
  agentType: string;
  text: string;
  onOpen?: () => void;
}) {
  return (
    <Expandable
      label={
        <span className="flex min-w-0 items-center gap-2.5">
          <ArrowBendDownLeftIcon className="size-3.5 shrink-0 text-faint" />
          <span className="shrink-0 font-mono text-[13px] text-ink/80">
            {agentType}
          </span>
          <span className="truncate text-[13px] text-faint">handed back</span>
          {onOpen && (
            // A span, not a button: it sits inside the row's own toggle button.
            <span
              role="button"
              tabIndex={0}
              title="Open its tab"
              onClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                onOpen();
              }}
              className="shrink-0 rounded p-0.5 text-faint transition-colors hover:bg-white/[0.06] hover:text-ink"
            >
              <ArrowSquareOutIcon className="size-3.5" />
            </span>
          )}
        </span>
      }
    >
      <Markdown>{text || "(no text)"}</Markdown>
    </Expandable>
  );
}
