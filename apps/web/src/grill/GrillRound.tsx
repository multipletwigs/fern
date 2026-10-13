import { useAtom, useAtomSet } from "@effect/atom-react";
import type { Round } from "@repo/api";
import { ReviewEntry } from "@repo/ui/ReviewEntry";
import { ReviewLayout } from "@repo/ui/ReviewLayout";
import { RoundProgress } from "@repo/ui/RoundProgress";
import { Cause, Exit, Option } from "effect";
import { type KeyboardEvent, useRef, useState } from "react";
import { type Move, moveFrom } from "../review/navigation";
import { answerRoundAtom, draftAtom } from "./atoms";
import {
  type Answer,
  type Draft,
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

// An open Round in the review layout: its questions listed on the left, checked once answered, and
// one question at a time on the right, with the review step after the last. The recommended answer
// is picked to begin with; Enter accepts it and slides to the next open question, the number keys
// pick another, `j`/`k` and ← move. The answers go to the Session together from the review step.
// `active` is false while the Session is out of sight.
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
  // The review step comes last and is never open, so moving to the next open question skips it.
  const settled = (answers: Draft["answers"]) => [
    ...questions.map((q) => answers[q.id] !== undefined),
    true,
  ];

  const goTo = (to: number) => {
    setFailure(undefined);
    setDraft({ ...draft, index: Math.max(0, Math.min(to, questions.length)) });
  };
  const move = (how: Move) =>
    goTo(moveFrom(settled(draft.answers), index, how) ?? questions.length);
  const pick = (answer: Answer) => {
    if (!question) return;
    setDraft({ ...draft, picks: { ...draft.picks, [question.id]: answer } });
  };
  const accept = () => {
    if (!question || !picked || !isComplete(picked)) return;
    const { [question.id]: _, ...picks } = draft.picks;
    const answers = { ...draft.answers, [question.id]: picked };
    setDraft({
      index: moveFrom(settled(answers), index, "nextOpen") ?? questions.length,
      answers,
      picks,
    });
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

  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (question) accept();
      else if (answered < questions.length) move("nextOpen");
      else void submit();
      return;
    }
    if (event.key === "j" || event.key === "k") {
      event.preventDefault();
      move(event.key === "j" ? "next" : "previous");
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "Backspace") {
      if (index > 0) {
        event.preventDefault();
        move("previous");
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
  };

  const items = [
    ...questions.map((q, at) => {
      const answer = draft.answers[q.id];
      const choosing = pickedFor(q, draft);
      return {
        key: q.id,
        entry: (
          <ReviewEntry
            number={at + 1}
            title={q.title}
            detail={answer && answerLabel(answer)}
            settled={answer !== undefined}
          />
        ),
        pane: (
          <GrillQuestion
            question={q}
            number={at + 1}
            total={questions.length}
            picked={choosing}
            last={questions.every(
              (other) => other.id === q.id || draft.answers[other.id],
            )}
            freeTextRef={at === index ? freeText : undefined}
            onPick={pick}
            onAccept={accept}
            onBack={at > 0 ? () => move("previous") : undefined}
          />
        ),
      };
    }),
    {
      key: "review",
      entry: (
        <ReviewEntry
          title="Send answers"
          detail={`${answered} of ${questions.length} answered`}
          settled={answered === questions.length}
          step
        />
      ),
      pane: (
        <GrillReview
          total={questions.length}
          open={questions.length - answered}
          sending={sending}
          failure={failure}
          onSend={() => void submit()}
          onNextOpen={() => move("nextOpen")}
        />
      ),
    },
  ];

  return (
    <ReviewLayout
      label="Grill Round"
      header={<RoundProgress answered={answered} total={questions.length} />}
      items={items}
      at={index}
      active={active}
      onSelect={goTo}
      onKeyDown={onKey}
    />
  );
}
