import { CheckIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";

// A settled question, collapsed to one line: what was asked and what the developer answered.
export function DecisionRow({
  number,
  question,
  answer,
  ownWords,
}: {
  number: number;
  question: string;
  answer: string;
  // The answer is the developer's own words rather than one of the options.
  ownWords: boolean;
}) {
  return (
    <div className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px]">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-mint/[0.1] text-mint">
        <CheckIcon weight="bold" className="size-3" />
      </span>
      <span className="w-5 shrink-0 font-mono text-[11px] text-faint tabular-nums">
        {number}
      </span>
      <span className="min-w-0 flex-1 truncate text-ink/70">{question}</span>
      <span
        className={clsx(
          "max-w-[45%] shrink-0 truncate",
          ownWords ? "text-ink/80 italic" : "text-ink",
        )}
      >
        {answer}
      </span>
    </div>
  );
}
