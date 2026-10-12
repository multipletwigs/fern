import type { RoundQuestion } from "@repo/api";
import { ChoiceOption } from "@repo/ui/ChoiceOption";
import { FreeTextAnswer } from "@repo/ui/FreeTextAnswer";
import { Markdown } from "@repo/ui/Markdown";
import type { Ref } from "react";
import { type Answer, shortcutFor } from "./draft";

// One question of a Round, as the developer answers it: what's asked, the options with the agent's
// recommendation among them, a field for their own words, and why the agent recommends what it
// does.
export function GrillQuestion({
  question,
  number,
  total,
  picked,
  freeTextRef,
  onPick,
  onAccept,
}: {
  question: RoundQuestion;
  number: number;
  total: number;
  picked: Answer;
  freeTextRef: Ref<HTMLTextAreaElement>;
  onPick: (answer: Answer) => void;
  onAccept: () => void;
}) {
  return (
    <div className="animate-fade-in">
      <p className="font-mono text-[11px] tracking-wide text-amber/80 uppercase">
        Question {number} of {total}
      </p>
      <h2 className="mt-2 text-[26px] leading-9 font-medium text-balance text-ink">
        {question.title}
      </h2>
      {question.body.trim() && (
        <div className="text-muted [&>div]:my-2 [&>div]:text-[15px] [&>div]:text-ink/70">
          <Markdown>{question.body}</Markdown>
        </div>
      )}

      <div className="mt-6 space-y-2">
        {question.options.map((option, index) => (
          <ChoiceOption
            key={option}
            label={option}
            shortcut={shortcutFor(index)}
            recommended={option === question.recommended}
            selected={picked.kind === "choice" && picked.choice === option}
            onSelect={() => onPick({ kind: "choice", choice: option })}
          />
        ))}
        <FreeTextAnswer
          inputRef={freeTextRef}
          shortcut={shortcutFor(question.options.length)}
          value={picked.kind === "text" ? picked.text : ""}
          selected={picked.kind === "text"}
          onChange={(text) => onPick({ kind: "text", text })}
          onAccept={onAccept}
        />
      </div>

      {question.reasoning.trim() && (
        <div className="mt-6 rounded-xl border border-hairline bg-white/[0.015] px-4 py-3">
          <p className="font-mono text-[10px] tracking-wide text-faint uppercase">
            Why {question.recommended}
          </p>
          <p className="mt-1 text-[13px] leading-5 text-ink/70">
            {question.reasoning}
          </p>
        </div>
      )}
    </div>
  );
}
