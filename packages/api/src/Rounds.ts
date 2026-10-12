import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { SessionInUse, SessionNotFound, TranscriptError } from "./Sessions";

// A Round is a batch of questions the agent puts to the developer at once during Grill, through
// Fern's Round tool (ADR 0006). Each answer becomes a Decision, which belongs to the Project.

// One question of a Round, with the answer the agent recommends and why.
export class RoundQuestion extends Schema.Class<RoundQuestion>("RoundQuestion")(
  {
    id: Schema.String,
    title: Schema.String,
    // Markdown.
    body: Schema.String,
    options: Schema.Array(Schema.String),
    // One of `options`.
    recommended: Schema.String,
    reasoning: Schema.String,
  },
) {}

export class Round extends Schema.Class<Round>("Round")({
  id: Schema.String,
  sessionId: Schema.String,
  questions: Schema.Array(RoundQuestion),
  postedAt: Schema.DateTimeUtcFromMillis,
}) {}

// A question settled with the developer: the option they chose, their own words, or both.
export class Decision extends Schema.Class<Decision>("Decision")({
  id: Schema.String,
  // The Project's folder.
  project: Schema.String,
  sessionId: Schema.String,
  roundId: Schema.String,
  questionId: Schema.String,
  question: Schema.String,
  choice: Schema.optional(Schema.String),
  freeText: Schema.optional(Schema.String),
  // Whether the choice was the agent's recommendation.
  recommended: Schema.Boolean,
  decidedAt: Schema.DateTimeUtcFromMillis,
}) {}

// A Session's Grill as the developer sees it: the Round waiting for answers, if any, and every
// Decision settled so far, oldest first.
export class SessionRounds extends Schema.Class<SessionRounds>("SessionRounds")(
  {
    open: Schema.optional(Round),
    decisions: Schema.Array(Decision),
  },
) {}

// The developer's answer to one question: one of its options, their own words, or both.
export const RoundAnswer = Schema.Struct({
  question: Schema.NonEmptyString,
  choice: Schema.optional(Schema.NonEmptyString),
  text: Schema.optional(Schema.String),
}).check(
  Schema.makeFilter((a) =>
    a.choice !== undefined || (a.text ?? "").trim() !== ""
      ? undefined
      : "an answer needs a choice or text",
  ),
);
export type RoundAnswer = typeof RoundAnswer.Type;

export const RoundAnswers = Schema.Struct({
  answers: Schema.Array(RoundAnswer),
});
export type RoundAnswers = typeof RoundAnswers.Type;

export class RoundNotFound extends Schema.TaggedError<RoundNotFound>()(
  "RoundNotFound",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

// The Round was answered already, or the agent has posted a newer one in its place.
export class RoundClosed extends Schema.TaggedError<RoundClosed>()(
  "RoundClosed",
  { id: Schema.String },
  { httpApiStatus: 409 },
) {}

// The answers don't fit the Round: a question left out or unknown, or a choice it doesn't offer.
export class InvalidAnswers extends Schema.TaggedError<InvalidAnswers>()(
  "InvalidAnswers",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

export class RoundsApi extends HttpApiGroup.make("rounds")
  .add(
    // Answers every question of an open Round. Each answer is recorded as a Decision, and all of
    // them go back to the Session as one message.
    HttpApiEndpoint.post("answer", "/:id/answers", {
      params: { id: Schema.NonEmptyString },
      payload: RoundAnswers,
      success: HttpApiSchema.NoContent,
      error: [
        RoundNotFound,
        RoundClosed,
        InvalidAnswers,
        SessionNotFound,
        SessionInUse,
        TranscriptError,
      ],
    }),
  )
  .prefix("/rounds") {}
