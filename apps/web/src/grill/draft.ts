import type { RoundQuestion } from "@repo/api";

// An answer to one question: one of its options, or the developer's own words.
export type Answer =
  | { readonly kind: "choice"; readonly choice: string }
  | { readonly kind: "text"; readonly text: string };

// Where the developer is in a Round: the question on screen (the questions' count once every one is
// answered), the answers accepted so far, and what's picked but not yet accepted, by question id.
export interface Draft {
  readonly index: number;
  readonly answers: Readonly<Record<string, Answer>>;
  readonly picks: Readonly<Record<string, Answer>>;
}

export const emptyDraft: Draft = { index: 0, answers: {}, picks: {} };

// What a question shows as picked: what the developer just picked, else their accepted answer,
// else the agent's recommendation.
export const pickedFor = (question: RoundQuestion, draft: Draft): Answer =>
  draft.picks[question.id] ??
  draft.answers[question.id] ?? {
    kind: "choice",
    choice: question.recommended,
  };

export const answerLabel = (answer: Answer) =>
  answer.kind === "choice" ? answer.choice : answer.text;

// An answer that can be sent: a choice, or words that aren't blank.
export const isComplete = (answer: Answer) =>
  answer.kind === "choice" || answer.text.trim() !== "";

// The answers as the server takes them, in the Round's order.
export const toPayload = (
  questions: ReadonlyArray<RoundQuestion>,
  draft: Draft,
) =>
  questions.map((question) => {
    const answer = draft.answers[question.id] ?? pickedFor(question, draft);
    return answer.kind === "choice"
      ? { question: question.id, choice: answer.choice }
      : { question: question.id, text: answer.text.trim() };
  });

// The key that picks the option at `index`.
export const shortcutFor = (index: number) => String(index + 1);

// The answers as the message the agent gets, shown in the transcript until Claude Code records the
// one Fern sent.
export const answersText = (
  questions: ReadonlyArray<RoundQuestion>,
  draft: Draft,
) =>
  [
    "My answers to your Round:",
    ...questions.map((question, index) => {
      const answer = draft.answers[question.id] ?? pickedFor(question, draft);
      return `${index + 1}. ${question.title}\n   ${answerLabel(answer)}`;
    }),
  ].join("\n\n");
