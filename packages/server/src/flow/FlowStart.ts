import { tool } from "@anthropic-ai/claude-agent-sdk";
import {
  FlowStart as FlowStartState,
  FlowStarted,
  GrillSuggestionClosed,
  GrillSuggestionNotFound,
  GrillSuggestionStatus,
  type OutgoingMessage,
  SessionArchived,
  SessionBusy,
  type SessionInUse,
  SessionNotFound,
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
import { reply } from "../stack/Stacks";
import { FernTools } from "../turn/FernTools";
import { HostedSessions } from "../turn/HostedSessions";
import { Turns } from "../turn/Turns";
import { Worktrees } from "../worktree/Worktrees";
import { GRILL, grillTopic, raised, SUGGEST_GRILL } from "./grill";

// What a Hosted Session is told while it's a chat, its Flow not started (ADR 0010).
export const CHAT_STEERING = `This Session is hosted by Fern. It starts as a chat with the developer about their Project: answer their questions, explore the code with them, and make the small, obvious changes they ask for. Bigger work goes through Fern's Flow (Grill, then Spec, then Implement, then Retro), which only the developer starts. When the conversation lands on something worth building that needs decisions first, more than a small, obvious fix, call Fern's \`${SUGGEST_GRILL}\` tool with that work in a line, then end your turn without starting it. If the developer starts the Grill, its command arrives as your next message. If they turn a suggestion down, Fern tells you; don't suggest that work again, only work the conversation turns to next.`;

const SUGGEST = `Suggest the developer Grill a piece of work before it's built: Fern shows them a card with the work in a line, which they can edit, start the Grill on, or turn down for now. Returns at once; end your turn after calling it, without starting the work.`;

const SuggestionRow = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  what: Schema.String,
  status: GrillSuggestionStatus,
  raisedAt: Schema.Finite,
  toldAt: Schema.NullOr(Schema.Finite),
});
type SuggestionRow = typeof SuggestionRow.Type;

// What Claude hears of the suggestions the developer turned down since it last heard, ahead of the
// developer's next message, out of the developer's sight as the transcript leaves reminders out.
const turnedDown = (rows: ReadonlyArray<SuggestionRow>) =>
  `<system-reminder>The developer turned down the Grill for ${rows
    .map((row) => `"${row.what}"`)
    .join(
      ", ",
    )} for now. Don't suggest that work again; suggest a Grill only for different work the conversation turns to.</system-reminder>`;

// How a Hosted Session gets into its Flow: it starts as a chat, Claude raises Grill suggestions
// when the chat lands on something worth building, and the developer starts the Grill, from one
// or on their own, or turns a suggestion down for now (ADR 0010).
export class FlowStart extends Context.Service<
  FlowStart,
  {
    // How the Session stands with its Flow, and its Grill suggestions, re-sent whenever either
    // changes. Null for a Session Fern didn't start.
    state(sessionId: string): Stream.Stream<FlowStartState | null>;
    // Starts the Session's Flow with its Grill on `what`, sent after the chat so far: renames its
    // branch after the work, and opens Claude Code again so its next turn has the Flow's tools.
    // `message` is the developer's own Grill command, when they typed one.
    grill(
      sessionId: string,
      input: {
        readonly what: string;
        readonly suggestion?: string;
        readonly message?: OutgoingMessage;
      },
    ): Effect.Effect<
      void,
      | FlowStarted
      | GrillSuggestionNotFound
      | GrillSuggestionClosed
      | SessionBusy
      | SessionNotFound
      | SessionArchived
      | SessionInUse
      | TranscriptError
    >;
    dismiss(
      id: string,
    ): Effect.Effect<void, GrillSuggestionNotFound | GrillSuggestionClosed>;
    // Sends the developer's message into the Session: the Grill's command typed into a chat starts
    // its Flow, and Claude hears of suggestions turned down since its last message.
    send(
      sessionId: string,
      message: OutgoingMessage,
    ): Effect.Effect<
      void,
      SessionNotFound | SessionBusy | SessionInUse | TranscriptError
    >;
  }
>()("@repo/server/flow/FlowStart") {
  static readonly layer = Layer.effect(
    FlowStart,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const hosted = yield* HostedSessions;
      const turns = yield* Turns;
      const worktrees = yield* Worktrees;
      const tools = yield* FernTools;
      const version = yield* SubscriptionRef.make(0);
      const bump = SubscriptionRef.update(version, (n) => n + 1);
      // One start or decision at a time, so a suggestion is decided, and a Flow started, once.
      const deciding = yield* Semaphore.make(1);
      yield* hosted.changes.pipe(
        Stream.runForEach(() => bump),
        Effect.forkScoped,
      );

      const suggestionsOf = SqlSchema.findAll({
        Request: Schema.String,
        Result: SuggestionRow,
        execute: (sessionId) => sql`
          SELECT id, session_id, what, status, raised_at, told_at FROM grill_suggestions
          WHERE session_id = ${sessionId} ORDER BY raised_at, rowid`,
      });
      const suggestionRow = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: SuggestionRow,
        execute: (id) => sql`
          SELECT id, session_id, what, status, raised_at, told_at FROM grill_suggestions
          WHERE id = ${id}`,
      });

      const read = (sessionId: string) =>
        Effect.gen(function* () {
          const session = yield* hosted.session(sessionId);
          if (!session) return null;
          const rows = yield* suggestionsOf(sessionId).pipe(Effect.orDie);
          return new FlowStartState({
            sessionId,
            started: session.flowStartedAt !== null,
            suggestions: rows.map((row) => ({
              id: row.id,
              what: row.what,
              status: row.status,
              raisedAt: DateTime.makeUnsafe(row.raisedAt),
            })),
          });
        });

      const state = (sessionId: string) =>
        SubscriptionRef.changes(version).pipe(
          Stream.mapEffect(() => read(sessionId)),
          Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        );

      // `suggest_grill`: one suggestion waits on the developer at a time.
      const suggest = Effect.fn("FlowStart.suggest")(
        function* (sessionId: string, what: string) {
          const session = yield* hosted.session(sessionId);
          if (session?.flowStartedAt !== null)
            return {
              text: "This Session's Flow has started already; there's no Grill to suggest.",
              isError: true,
            };
          const waiting = (yield* suggestionsOf(sessionId)).find(
            (row) => row.status === "pending",
          );
          if (waiting)
            return {
              text: `A Grill suggestion already waits on the developer: "${waiting.what}". End your turn now.`,
              isError: true,
            };
          const id = crypto.randomUUID();
          const raisedAt = yield* Clock.currentTimeMillis;
          yield* sql`INSERT INTO grill_suggestions ${sql.insert({
            id,
            sessionId,
            what: what.trim(),
            status: "pending",
            raisedAt,
          })}`;
          yield* bump;
          return { text: raised(id), isError: false };
        },
        deciding.withPermits(1),
        Effect.orDie,
      );

      const decide = (id: string, status: GrillSuggestionStatus) =>
        Effect.gen(function* () {
          const at = yield* Clock.currentTimeMillis;
          yield* sql`UPDATE grill_suggestions SET status = ${status}, decided_at = ${at}
            WHERE id = ${id}`.pipe(Effect.orDie);
        });

      const open = (id: string) =>
        Effect.gen(function* () {
          const row = yield* suggestionRow(id).pipe(Effect.orDie);
          if (Option.isNone(row))
            return yield* new GrillSuggestionNotFound({ id });
          if (row.value.status !== "pending")
            return yield* new GrillSuggestionClosed({ id });
          return row.value;
        });

      const grill = Effect.fn("FlowStart.grill")(function* (
        sessionId: string,
        input: {
          readonly what: string;
          readonly suggestion?: string;
          readonly message?: OutgoingMessage;
        },
      ) {
        const session = yield* hosted.session(sessionId);
        if (!session) return yield* new SessionNotFound({ id: sessionId });
        if (session.archivedAt !== null)
          return yield* new SessionArchived({ id: sessionId });
        if (session.flowStartedAt !== null)
          return yield* new FlowStarted({ session: sessionId });
        if ((yield* turns.turn(sessionId))?.running)
          return yield* new SessionBusy({ id: sessionId });
        const suggestion = input.suggestion
          ? yield* open(input.suggestion)
          : undefined;
        if (suggestion && suggestion.sessionId !== sessionId)
          return yield* new GrillSuggestionNotFound({ id: suggestion.id });
        const what = input.what.trim();
        // Named after the work from here, before any of it goes up as a PR. A rename that fails
        // leaves the branch as it was.
        const worktree = (yield* hosted.worktrees).find(
          (w) => w.id === sessionId,
        );
        if (worktree && what !== "")
          yield* worktrees
            .rename(worktree.worktree, worktree.branch, what)
            .pipe(
              Effect.flatMap((branch) =>
                branch === worktree.branch
                  ? Effect.void
                  : hosted.setBranch(sessionId, branch),
              ),
              Effect.catch((error) =>
                Effect.logWarning("Couldn't rename the branch", error.message),
              ),
            );
        // Started before the Grill goes in, so Claude Code opens again with the Flow's tools; a
        // Grill that never reaches the Session takes the start back.
        yield* hosted.startFlow(sessionId);
        yield* turns.close(sessionId);
        yield* turns
          .send(sessionId, input.message ?? { text: `${GRILL} ${what}` })
          .pipe(Effect.tapError(() => hosted.unstartFlow(sessionId)));
        if (suggestion) yield* decide(suggestion.id, "started");
        return yield* bump;
      }, deciding.withPermits(1));

      const dismiss = Effect.fn("FlowStart.dismiss")(function* (id: string) {
        yield* open(id);
        yield* decide(id, "dismissed");
        yield* bump;
      }, deciding.withPermits(1));

      const send = Effect.fn("FlowStart.send")(function* (
        sessionId: string,
        message: OutgoingMessage,
      ) {
        const session = yield* hosted.session(sessionId);
        const chat = session !== undefined && session.flowStartedAt === null;
        const topic = chat ? grillTopic(message.text) : undefined;
        // In a chat, so its Flow hasn't started, and no suggestion is named. An Archived Session's
        // worktree is gone, as good as not found.
        if (topic !== undefined)
          return yield* grill(sessionId, { what: topic, message }).pipe(
            Effect.catchTags({
              FlowStarted: Effect.die,
              GrillSuggestionNotFound: Effect.die,
              GrillSuggestionClosed: Effect.die,
              SessionArchived: () => new SessionNotFound({ id: sessionId }),
            }),
          );
        if (!chat) return yield* turns.send(sessionId, message);
        const untold = (yield* suggestionsOf(sessionId).pipe(
          Effect.orDie,
        )).filter((row) => row.status === "dismissed" && row.toldAt === null);
        if (untold.length === 0) return yield* turns.send(sessionId, message);
        yield* turns.send(sessionId, {
          ...message,
          text: `${message.text}\n\n${turnedDown(untold)}`,
        });
        const at = yield* Clock.currentTimeMillis;
        return yield* sql`UPDATE grill_suggestions SET told_at = ${at}
          WHERE id IN ${sql.in(untold.map((row) => row.id))}`.pipe(
          Effect.orDie,
        );
      });

      const run = Effect.runPromiseWith(yield* Effect.context());
      yield* tools.register({
        steering: CHAT_STEERING,
        when: (sessionId) =>
          hosted
            .session(sessionId)
            .pipe(
              Effect.map(
                (session) =>
                  session !== undefined && session.flowStartedAt === null,
              ),
            ),
        tools: (sessionId) => [
          tool(
            SUGGEST_GRILL,
            SUGGEST,
            {
              what: z
                .string()
                .min(1)
                .describe(
                  "The work to Grill, in a line, as its Grill would start on it",
                ),
            },
            ({ what }) => run(suggest(sessionId, what).pipe(Effect.map(reply))),
          ),
        ],
      });

      return FlowStart.of({ state, grill, dismiss, send });
    }),
  );
}
