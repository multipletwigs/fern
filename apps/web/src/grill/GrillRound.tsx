import { useAtom, useAtomSet } from "@effect/atom-react";
import type { Round } from "@repo/api";
import { DecisionRow } from "@repo/ui/DecisionRow";
import { KeyHint } from "@repo/ui/KeyHint";
import { RoundProgress } from "@repo/ui/RoundProgress";
import { Cause, Exit, Option } from "effect";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { answerRoundAtom, draftAtom } from "./atoms";
import {
  type Answer,
  answerLabel,
  answersText,
  emptyDraft,
  isComplete,
  pickedFor,
  toPayload,
} from "./draft";
import { GrillQuestion } from "./GrillQuestion";
import { GrillReview } from "./GrillReview";

const failureNotice = (tag: string | undefined) => {
  switch (tag) {
    case "RoundClosed":
      return "This Round is closed: it was answered, or Claude asked a newer one.";
    case "SessionInUse":
      return "This Session is running somewhere else right now. Try again once it's idle.";
    case "InvalidAnswers":
      return "Some answers don't fit this Round. Check them and try again.";
    default:
      return "Couldn't send your answers. Try again.";
  }
};

// Keys typed into a field are the field's.
const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT");

// An open Round, one question at a time: the recommended answer picked to begin with, Enter to
// accept, the number keys to pick another, ← to go back. Answered questions collapse into a list
// above, and the answers go to the Session together once the last is answered. `active` is false
// while the Session is out of sight, so its keys are left alone.
export function GrillRound({
  round,
  active,
  onSending,
  onFailed,
}: {
  round: Round;
  active: boolean;
  // The answers are on their way, as the agent will read them.
  onSending: (text: string) => void;
  onFailed: () => void;
}) {
  const [draft, setDraft] = useAtom(draftAtom(round.id));
  const send = useAtomSet(answerRoundAtom, { mode: "promiseExit" });
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string>();
  const freeText = useRef<HTMLTextAreaElement>(null);

  const { questions } = round;
  const index = Math.min(draft.index, questions.length);
  const question = questions[index];
  const picked = question ? pickedFor(question, draft) : undefined;
  const answered = questions.filter((q) => draft.answers[q.id]).length;

  const pick = (answer: Answer) => {
    if (!question) return;
    setDraft({ ...draft, picks: { ...draft.picks, [question.id]: answer } });
  };
  const accept = () => {
    if (!question || !picked || !isComplete(picked)) return;
    const { [question.id]: _, ...picks } = draft.picks;
    setDraft({
      index: index + 1,
      answers: { ...draft.answers, [question.id]: picked },
      picks,
    });
  };
  const goTo = (to: number) => {
    setFailure(undefined);
    setDraft({ ...draft, index: Math.max(0, Math.min(to, questions.length)) });
  };
  const submit = async () => {
    if (sending) return;
    setSending(true);
    setFailure(undefined);
    onSending(answersText(questions, draft));
    const exit = await send({
      params: { id: round.id },
      payload: { answers: toPayload(questions, draft) },
    });
    setSending(false);
    if (Exit.isSuccess(exit)) {
      setDraft(emptyDraft);
      return;
    }
    onFailed();
    const error = Cause.findErrorOption(exit.cause);
    setFailure(failureNotice(Option.getOrUndefined(error)?._tag));
  };

  // The keys, read from the page while the Grill shows, so they work without clicking into it.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditable(event.target)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (question) accept();
      else void submit();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "Backspace") {
      if (index > 0) {
        event.preventDefault();
        goTo(index - 1);
      }
      return;
    }
    if (!question) return;
    const options = question.options;
    const number = Number(event.key);
    if (Number.isInteger(number) && number >= 1) {
      if (number <= options.length) {
        event.preventDefault();
        const choice = options[number - 1];
        if (choice !== undefined) pick({ kind: "choice", choice });
      } else if (number === options.length + 1) {
        event.preventDefault();
        freeText.current?.focus();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const at =
        picked?.kind === "choice"
          ? options.indexOf(picked.choice)
          : options.length;
      const next =
        event.key === "ArrowDown"
          ? Math.min(at + 1, options.length - 1)
          : Math.max(at - 1, 0);
      const choice = options[next];
      if (choice !== undefined) pick({ kind: "choice", choice });
    }
  });
  useEffect(() => {
    if (!active) return undefined;
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [active]);

  // Answered questions other than the one on screen, in the Round's order.
  const settled = questions.flatMap((q, at) => {
    const answer = draft.answers[q.id];
    return answer && at !== index ? [{ q, at, answer }] : [];
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-[680px] flex-col px-8 pt-6 pb-10">
        <RoundProgress answered={answered} total={questions.length} />

        {settled.length > 0 && (
          <div className="mt-6">
            <p className="mb-1 px-2.5 font-mono text-[10px] tracking-wide text-faint uppercase">
              Decisions
            </p>
            {settled.map(({ q, at, answer }) => (
              <DecisionRow
                key={q.id}
                number={at + 1}
                question={q.title}
                answer={answerLabel(answer)}
                ownWords={answer.kind === "text"}
                onOpen={() => goTo(at)}
              />
            ))}
          </div>
        )}

        <div className="my-auto pt-10 pb-6" key={index}>
          {question && picked ? (
            <GrillQuestion
              question={question}
              number={index + 1}
              total={questions.length}
              picked={picked}
              freeTextRef={freeText}
              onPick={pick}
              onAccept={accept}
            />
          ) : (
            <GrillReview
              total={questions.length}
              sending={sending}
              failure={failure}
              onSend={() => void submit()}
            />
          )}
        </div>

        {question && picked && (
          <div className="flex items-center gap-4">
            <button
              type="button"
              disabled={!isComplete(picked)}
              onClick={accept}
              className="flex h-10 items-center gap-2.5 rounded-xl bg-ink px-4 text-[14px] font-medium text-canvas transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
            >
              {index + 1 === questions.length ? "Done" : "OK"}
              <span className="font-mono text-[11px] opacity-60">↵</span>
            </button>
            {index > 0 && (
              <button
                type="button"
                onClick={() => goTo(index - 1)}
                className="flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-ink"
              >
                <KeyHint>←</KeyHint> Back
              </button>
            )}
            <span className="ml-auto text-[12px] text-faint">
              Press{" "}
              <span className="font-mono text-ink/60">
                1–{question.options.length + 1}
              </span>{" "}
              to pick
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
