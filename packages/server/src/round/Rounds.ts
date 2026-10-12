import {
  Decision,
  InvalidAnswers,
  Round,
  type RoundAnswer,
  RoundClosed,
  RoundNotFound,
  RoundQuestion,
  type SessionInUse,
  type SessionNotFound,
  SessionRounds,
  type TranscriptError,
} from "@repo/api";
import {
  Clock,
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { z } from "zod";
import { FernTools, fernTool } from "../turn/FernTools";
import { HostedSessions } from "../turn/HostedSessions";
import { Turns } from "../turn/Turns";

// A question as the agent asks it, before Fern numbers it.
export type QuestionInput = Omit<RoundQuestion, "id">;

// The agent's Round doesn't hold together, e.g. it recommends an option it doesn't offer.
export class InvalidRound extends Schema.TaggedError<InvalidRound>()(
  "InvalidRound",
  { message: Schema.String },
) {}

const RoundRow = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  questions: Schema.fromJsonString(Schema.Array(RoundQuestion)),
  postedAt: Schema.Finite,
  answeredAt: Schema.NullOr(Schema.Finite),
  supersededAt: Schema.NullOr(Schema.Finite),
});
type RoundRow = typeof RoundRow.Type;

const DecisionRow = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  sessionId: Schema.String,
  roundId: Schema.String,
  questionId: Schema.String,
  question: Schema.String,
  choice: Schema.NullOr(Schema.String),
  freeText: Schema.NullOr(Schema.String),
  recommended: Schema.Int,
  decidedAt: Schema.Finite,
});
type DecisionRow = typeof DecisionRow.Type;

const toRound = (row: RoundRow) =>
  new Round({
    id: row.id,
    sessionId: row.sessionId,
    questions: row.questions,
    postedAt: DateTime.makeUnsafe(row.postedAt),
  });

const toDecision = (row: DecisionRow) =>
  new Decision({
    id: row.id,
    project: row.project,
    sessionId: row.sessionId,
    roundId: row.roundId,
    questionId: row.questionId,
    question: row.question,
    choice: row.choice ?? undefined,
    freeText: row.freeText ?? undefined,
    recommended: row.recommended === 1,
    decidedAt: DateTime.makeUnsafe(row.decidedAt),
  });

const TOOL = "post_round";

const STEERING = `During Grill, ask the developer Grill questions only through the ${TOOL} tool, never as questions written in your reply. Put every question you have for now into one Round: each with a title, the context the developer needs, its options, the option you recommend and your reasoning. The tool returns at once; end your turn right after calling it. The developer's answers arrive as your next message, and the next Round can build on them.`;

const POSTED =
  "Round posted. End your turn now: the developer's answers arrive as your next message.";

// What the Round tool takes. Claude Code checks the agent's input against it before Fern sees it.
const roundShape = {
  questions: z
    .array(
      z.object({
        title: z.string().min(1).describe("The question, in one line."),
        body: z
          .string()
          .describe("What the developer needs to know to answer, in Markdown."),
        options: z
          .array(z.string().min(1))
          .min(2)
          .describe(
            "The answers to choose from, the recommended one included.",
          ),
        recommended: z
          .string()
          .describe("The option you recommend, exactly as written in options."),
        reasoning: z.string().describe("Why you recommend it."),
      }),
    )
    .min(1),
};

// Whether a Round's questions hold together, and why not.
const roundProblem = (questions: ReadonlyArray<QuestionInput>) => {
  for (const q of questions) {
    if (new Set(q.options).size !== q.options.length)
      return `"${q.title}" offers the same option twice.`;
    if (!q.options.includes(q.recommended))
      return `"${q.title}" recommends "${q.recommended}", which isn't one of its options.`;
  }
  return undefined;
};

// Whether the answers cover each question of the Round once with an answer it allows, and why not.
const answersProblem = (
  round: RoundRow,
  answers: ReadonlyArray<RoundAnswer>,
) => {
  const byId = new Map(round.questions.map((q) => [q.id, q]));
  const seen = new Set<string>();
  for (const answer of answers) {
    const question = byId.get(answer.question);
    if (!question) return `The Round has no question ${answer.question}.`;
    if (seen.has(answer.question))
      return `Question ${answer.question} is answered twice.`;
    seen.add(answer.question);
    if (
      answer.choice !== undefined &&
      !question.options.includes(answer.choice)
    )
      return `"${answer.choice}" isn't an option of "${question.title}".`;
  }
  const missing = round.questions.find((q) => !seen.has(q.id));
  return missing ? `"${missing.title}" has no answer.` : undefined;
};

// One answer as the agent reads it.
const answerLine = (question: RoundQuestion, answer: RoundAnswer) => {
  const text = answer.text?.trim();
  if (answer.choice === undefined) return text ?? "";
  const choice =
    answer.choice === question.recommended
      ? `${answer.choice} (your recommendation)`
      : answer.choice;
  return text ? `${choice}. ${text}` : choice;
};

// Every answer to the Round, in the Round's order, as one message to the agent.
export const answersMessage = (
  questions: ReadonlyArray<RoundQuestion>,
  answers: ReadonlyArray<RoundAnswer>,
) => {
  const byQuestion = new Map(answers.map((a) => [a.question, a]));
  const lines = questions.flatMap((question, index) => {
    const answer = byQuestion.get(question.id);
    return answer
      ? [`${index + 1}. ${question.title}\n   ${answerLine(question, answer)}`]
      : [];
  });
  return `My answers to your Round:\n\n${lines.join("\n\n")}`;
};

// Rounds the agent asks through Fern's Round tool during Grill, and the Decisions answering them
// settles (ADR 0006). Rounds and Decisions are kept in the database, so an open Round is still
// waiting after Fern restarts.
export class Rounds extends Context.Service<
  Rounds,
  {
    // Opens a Round on the Session, in place of any Round still open there.
    post(
      session: string,
      questions: ReadonlyArray<QuestionInput>,
    ): Effect.Effect<Round, InvalidRound>;
    // Records a Decision per question of the open Round, then sends all the answers to the
    // Session as one message.
    answer(
      round: string,
      answers: ReadonlyArray<RoundAnswer>,
    ): Effect.Effect<
      void,
      | RoundNotFound
      | RoundClosed
      | InvalidAnswers
      | SessionNotFound
      | SessionInUse
      | TranscriptError
    >;
    // The Session's open Round and its Decisions, re-sent whenever either changes.
    list(session: string): Stream.Stream<SessionRounds>;
  }
>()("@repo/server/round/Rounds") {
  static readonly layer = Layer.effect(
    Rounds,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const turns = yield* Turns;
      const hosted = yield* HostedSessions;
      const tools = yield* FernTools;
      // Bumped after every write, so open lists reload.
      const version = yield* SubscriptionRef.make(0);
      const bump = SubscriptionRef.update(version, (n) => n + 1);
      // Answers one at a time, so a Round is answered, and its answers sent, exactly once.
      const answering = yield* Semaphore.make(1);

      const openRound = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: RoundRow,
        execute: (session) => sql`
          SELECT * FROM rounds
          WHERE session_id = ${session} AND answered_at IS NULL AND superseded_at IS NULL
          ORDER BY posted_at DESC LIMIT 1`,
      });
      const roundById = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: RoundRow,
        execute: (id) => sql`SELECT * FROM rounds WHERE id = ${id}`,
      });
      const decisionsOf = SqlSchema.findAll({
        Request: Schema.String,
        Result: DecisionRow,
        execute: (session) => sql`
          SELECT d.* FROM decisions d JOIN rounds r ON r.id = d.round_id
          WHERE d.session_id = ${session}
          ORDER BY d.decided_at, r.posted_at, d.rowid`,
      });

      const post = Effect.fn("Rounds.post")(function* (
        session: string,
        questions: ReadonlyArray<QuestionInput>,
      ) {
        const problem = roundProblem(questions);
        if (problem) return yield* new InvalidRound({ message: problem });
        const now = yield* Clock.currentTimeMillis;
        const round = new Round({
          id: crypto.randomUUID(),
          sessionId: session,
          questions: questions.map(
            (q, index) => new RoundQuestion({ ...q, id: `q${index + 1}` }),
          ),
          postedAt: DateTime.makeUnsafe(now),
        });
        const encoded = yield* Schema.encodeEffect(
          Schema.fromJsonString(Schema.Array(RoundQuestion)),
        )(round.questions).pipe(Effect.orDie);
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`UPDATE rounds SET superseded_at = ${now}
              WHERE session_id = ${session} AND answered_at IS NULL AND superseded_at IS NULL`;
              yield* sql`INSERT INTO rounds ${sql.insert({
                id: round.id,
                sessionId: session,
                questions: encoded,
                postedAt: now,
              })}`;
            }),
          )
          .pipe(Effect.orDie);
        yield* bump;
        return round;
      });

      const answer = Effect.fn("Rounds.answer")(function* (
        id: string,
        answers: ReadonlyArray<RoundAnswer>,
      ) {
        const round = Option.getOrUndefined(
          yield* roundById(id).pipe(Effect.orDie),
        );
        if (!round) return yield* new RoundNotFound({ id });
        if (round.answeredAt !== null || round.supersededAt !== null)
          return yield* new RoundClosed({ id });
        const problem = answersProblem(round, answers);
        if (problem) return yield* new InvalidAnswers({ message: problem });
        const project = yield* hosted.projectOf(round.sessionId);
        if (project === undefined)
          return yield* Effect.die(
            `Round ${id} is on ${round.sessionId}, which Fern didn't start`,
          );
        // Sent first: if the Session can't take it, nothing is settled and the developer can
        // answer again.
        yield* turns.send(round.sessionId, {
          text: answersMessage(round.questions, answers),
        });
        const now = yield* Clock.currentTimeMillis;
        const byQuestion = new Map(answers.map((a) => [a.question, a]));
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`UPDATE rounds SET answered_at = ${now} WHERE id = ${id}`;
              for (const question of round.questions) {
                const given = byQuestion.get(question.id);
                const text = given?.text?.trim();
                yield* sql`INSERT INTO decisions ${sql.insert({
                  id: crypto.randomUUID(),
                  project,
                  sessionId: round.sessionId,
                  roundId: id,
                  questionId: question.id,
                  question: question.title,
                  choice: given?.choice ?? null,
                  freeText: text ? text : null,
                  recommended: given?.choice === question.recommended ? 1 : 0,
                  decidedAt: now,
                })}`;
              }
            }),
          )
          .pipe(Effect.orDie);
        return yield* bump;
      }, answering.withPermits(1));

      const list = (session: string) =>
        SubscriptionRef.changes(version).pipe(
          Stream.mapEffect(() =>
            Effect.all({
              open: openRound(session),
              decisions: decisionsOf(session),
            }).pipe(Effect.orDie),
          ),
          Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
          Stream.map(
            ({ open, decisions }) =>
              new SessionRounds({
                open: Option.getOrUndefined(Option.map(open, toRound)),
                decisions: decisions.map(toDecision),
              }),
          ),
        );

      // The Round tool, for every Hosted Session: the agent's call opens the Round and returns at
      // once, so no turn is held open while the developer answers.
      const run = Effect.runPromiseWith(yield* Effect.context());
      yield* tools.add({
        steering: STEERING,
        tools: (session) => [
          fernTool(
            TOOL,
            "Ask the developer a Round of Grill questions. Fern shows them one at a time with your recommendation pre-selected, and sends all the answers back as your next message. Returns at once; end your turn after calling it.",
            roundShape,
            (args) =>
              run(
                post(session, args.questions).pipe(
                  Effect.match({
                    onFailure: (error) => ({
                      content: [{ type: "text" as const, text: error.message }],
                      isError: true,
                    }),
                    onSuccess: () => ({
                      content: [{ type: "text" as const, text: POSTED }],
                    }),
                  }),
                ),
              ),
          ),
        ],
      });

      return Rounds.of({ post, answer, list });
    }),
  );
}
