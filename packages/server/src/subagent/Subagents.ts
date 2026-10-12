import {
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  listSubagents,
} from "@anthropic-ai/claude-agent-sdk";
import {
  SessionNotFound,
  SubagentHeader,
  SubagentNotFound,
  SubagentSummary,
  SubagentUpdate,
  TranscriptError,
  type TranscriptItem,
} from "@repo/api";
import {
  Clock,
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Predicate,
  Schedule,
  Stream,
  SubscriptionRef,
} from "effect";
import { SqlClient } from "effect/sql";
import { sdk } from "../agentSdk";
import { diffItems, type Sent } from "../transcript/diff";
import { buildItems, promptText, type StoredMessage } from "../transcript/View";
import { Turns } from "../turn/Turns";
import { type SubagentMetadata, SubagentFiles } from "./SubagentFiles";

// A Session's Subagents, read through the Agent SDK, which honours CLAUDE_CONFIG_DIR, with what
// Claude Code keeps beside their transcripts. Each one's Agent call, in the transcript of the
// Session or of the Subagent that started it, says how it went.

type SubagentItem = Extract<TranscriptItem, { _tag: "Subagent" }>;

// One Subagent's transcript, as read.
interface Transcript {
  readonly agentId: string;
  readonly messages: ReadonlyArray<StoredMessage>;
  readonly metadata: SubagentMetadata | undefined;
}

// The Agent calls in the transcripts read, by the agent they started and by their own id, and the
// Subagent whose transcript each call is in, by the call's id.
interface Calls {
  readonly byAgent: Map<string, SubagentItem>;
  readonly byCall: Map<string, SubagentItem>;
  readonly callers: Map<string, string>;
}

const noCalls = (): Calls => ({
  byAgent: new Map(),
  byCall: new Map(),
  callers: new Map(),
});

// `caller` is the Subagent whose work the items are; none for the Session's own.
const collectCalls = (
  items: ReadonlyArray<TranscriptItem>,
  calls: Calls,
  caller?: string,
) => {
  for (const item of items) {
    if (item._tag !== "Subagent") continue;
    calls.byCall.set(item.callId, item);
    if (item.agentId !== undefined) calls.byAgent.set(item.agentId, item);
    if (caller !== undefined) calls.callers.set(item.callId, caller);
  }
};

// The Agent call that started a Subagent, matched by its metadata or the call's result.
const callOf = (
  { agentId, metadata }: Pick<Transcript, "agentId" | "metadata">,
  calls: Calls,
) =>
  calls.byAgent.get(agentId) ??
  (metadata?.toolUseId === undefined
    ? undefined
    : calls.byCall.get(metadata.toolUseId));

// The Assignment is the Subagent's first message; its work is everything after it.
const assignmentOf = (messages: ReadonlyArray<StoredMessage>) => {
  const [first] = messages;
  return first?.type === "user" ? promptText(first) : "";
};
const workOf = (messages: ReadonlyArray<StoredMessage>) =>
  messages[0]?.type === "user" ? messages.slice(1) : messages;

// What the Subagent says of itself. Without metadata, its type and description come from its
// Agent call, else "Subagent" and the first line of its Assignment.
const summarize = (
  { agentId, messages, metadata }: Transcript,
  calls: Calls,
) => {
  const call = callOf({ agentId, metadata }, calls);
  const callId = metadata?.toolUseId ?? call?.callId;
  const startedAt = messages.find((m) => m.timestamp)?.timestamp;
  return {
    agentId,
    callId,
    agentType: metadata?.agentType ?? call?.agentType ?? "Subagent",
    description:
      metadata?.description ||
      call?.description ||
      assignmentOf(messages).split("\n")[0] ||
      "",
    status: call?.status ?? "running",
    startedAt:
      startedAt === undefined ? undefined : DateTime.makeUnsafe(startedAt),
    parentAgentId:
      metadata?.parentAgentId ??
      messages.find((m) => m.parent_agent_id)?.parent_agent_id ??
      (callId === undefined ? undefined : calls.callers.get(callId)),
  };
};

const sessionInfo = (sessionId: string) =>
  sdk("getSessionInfo", () => getSessionInfo(sessionId)).pipe(
    Effect.filterOrFail(
      Predicate.isNotUndefined,
      () => new SessionNotFound({ id: sessionId }),
    ),
  );

// Fails unless the Session has a Subagent by this id.
const known = (sessionId: string, agentId: string) =>
  sessionInfo(sessionId).pipe(
    Effect.andThen(sdk("listSubagents", () => listSubagents(sessionId))),
    Effect.filterOrFail(
      (ids) => ids.includes(agentId),
      () => new SubagentNotFound({ sessionId, agentId }),
    ),
    Effect.asVoid,
  );

const readSubagent = (
  sessionId: string,
  agentId: string,
  metadata: ReadonlyArray<SubagentMetadata>,
) =>
  sdk("getSubagentMessages", () =>
    getSubagentMessages(sessionId, agentId),
  ).pipe(
    Effect.map((messages): Transcript => ({
      agentId,
      messages,
      metadata: metadata.find((m) => m.agentId === agentId),
    })),
  );

const startMillis = (s: SubagentSummary) =>
  s.startedAt === undefined
    ? Number.POSITIVE_INFINITY
    : DateTime.toEpochMillis(s.startedAt);

export class Subagents extends Context.Service<
  Subagents,
  {
    // The Session's Subagents in the order they started, nested ones included, re-sent whenever
    // one starts or changes.
    list(
      sessionId: string,
    ): Effect.Effect<
      Stream.Stream<ReadonlyArray<SubagentSummary>, TranscriptError>,
      SessionNotFound | TranscriptError
    >;
    // One Subagent's Assignment and work as a stream of updates, re-read whenever its files or
    // the Session's change.
    live(
      sessionId: string,
      agentId: string,
    ): Effect.Effect<
      Stream.Stream<SubagentUpdate, TranscriptError>,
      SessionNotFound | SubagentNotFound | TranscriptError
    >;
    // Closes the Subagent's tab for the Session, until it's reopened.
    close(
      sessionId: string,
      agentId: string,
    ): Effect.Effect<
      void,
      SessionNotFound | SubagentNotFound | TranscriptError
    >;
    // Reopens the Subagent's closed tab.
    reopen(
      sessionId: string,
      agentId: string,
    ): Effect.Effect<
      void,
      SessionNotFound | SubagentNotFound | TranscriptError
    >;
  }
>()("@repo/server/subagent/Subagents") {
  static readonly layer = Layer.effect(
    Subagents,
    Effect.gen(function* () {
      const files = yield* SubagentFiles;
      const turns = yield* Turns;
      const sql = yield* SqlClient.SqlClient;
      // Bumped after every close and reopen, so open lists show it at once.
      const closings = yield* SubscriptionRef.make(0);

      const closedOf = (sessionId: string) =>
        sql<{ agentId: string }>`
          SELECT agent_id FROM closed_subagents WHERE session_id = ${sessionId}
        `.pipe(
          Effect.map((rows) => new Set(rows.map((row) => row.agentId))),
          Effect.orDie,
        );

      // Ticks whenever the Session's transcript or one of its Subagent files changes, or a turn
      // Fern runs starts or ends. A poll that misses the transcript skips a beat.
      const changes = (sessionId: string) =>
        Stream.fromEffectSchedule(
          Effect.all({
            latest: sdk("getSessionInfo", () => getSessionInfo(sessionId)),
            stamp: files.stamp(sessionId),
            turn: turns.turn(sessionId),
          }).pipe(
            Effect.map(({ latest, stamp, turn }) =>
              latest
                ? `${latest.lastModified}:${latest.fileSize}:${turn?.running}:${stamp}`
                : undefined,
            ),
          ),
          Schedule.spaced("400 millis"),
        ).pipe(Stream.filter(Predicate.isNotUndefined), Stream.changes);

      // The Session's own transcript and what Claude Code recorded of its Subagents.
      const readSession = (sessionId: string) =>
        Effect.all({
          info: sessionInfo(sessionId),
          messages: sdk("getSessionMessages", () =>
            getSessionMessages(sessionId),
          ),
          metadata: files.metadata(sessionId),
        });

      const summaries = Effect.fn("Subagents.summaries")(function* (
        sessionId: string,
      ) {
        const session = yield* readSession(sessionId);
        const context = {
          cwd: session.info.cwd ?? "",
          subagents: session.metadata,
        };
        const ids = yield* sdk("listSubagents", () => listSubagents(sessionId));
        const closed = yield* closedOf(sessionId);
        const read = yield* Effect.forEach(
          ids,
          (id) => readSubagent(sessionId, id, session.metadata),
          { concurrency: 4 },
        );
        // A Subagent whose first message isn't written yet shows on a later poll.
        const started = read.filter((t) => t.messages.length > 0);
        const calls = noCalls();
        collectCalls(buildItems(session.messages, context), calls);
        for (const t of started)
          collectCalls(
            buildItems(workOf(t.messages), context),
            calls,
            t.agentId,
          );
        return started
          .map((t) =>
            SubagentSummary.make({
              ...summarize(t, calls),
              closed: closed.has(t.agentId),
            }),
          )
          .toSorted((a, b) => startMillis(a) - startMillis(b));
      });

      const view = Effect.fn("Subagents.view")(function* (
        sessionId: string,
        agentId: string,
      ) {
        const session = yield* readSession(sessionId);
        const context = {
          cwd: session.info.cwd ?? "",
          subagents: session.metadata,
        };
        const own = yield* readSubagent(sessionId, agentId, session.metadata);
        const calls = noCalls();
        collectCalls(buildItems(session.messages, context), calls);
        // A nested Subagent's Agent call is in the transcript of the Subagent that started it: the
        // one it names, else whichever has the call.
        if (callOf(own, calls) === undefined) {
          const parentId = summarize(own, calls).parentAgentId;
          const others =
            parentId === undefined
              ? (yield* sdk("listSubagents", () =>
                  listSubagents(sessionId),
                )).filter((id) => id !== agentId)
              : [parentId];
          const read = yield* Effect.forEach(
            others,
            (id) => readSubagent(sessionId, id, session.metadata),
            { concurrency: 4 },
          );
          for (const t of read)
            collectCalls(
              buildItems(workOf(t.messages), context),
              calls,
              t.agentId,
            );
        }
        return {
          header: SubagentHeader.make(summarize(own, calls)),
          assignment: assignmentOf(own.messages),
          items: buildItems(workOf(own.messages), context),
        };
      });

      return Subagents.of({
        list: Effect.fn("Subagents.list")(function* (sessionId: string) {
          yield* sessionInfo(sessionId);
          return Stream.zipLatest(
            changes(sessionId),
            SubscriptionRef.changes(closings),
          ).pipe(
            Stream.mapEffect(() =>
              summaries(sessionId).pipe(
                Effect.asSome,
                Effect.catchTag("SessionNotFound", () => Effect.succeedNone),
              ),
            ),
            Stream.filter(Option.isSome),
            Stream.map((polled) => polled.value),
            Stream.changesWith(
              (a, b) => JSON.stringify(a) === JSON.stringify(b),
            ),
          );
        }),

        live: Effect.fn("Subagents.live")(function* (
          sessionId: string,
          agentId: string,
        ) {
          yield* known(sessionId, agentId);
          return changes(sessionId).pipe(
            Stream.mapEffect(() =>
              view(sessionId, agentId).pipe(
                Effect.asSome,
                Effect.catchTag("SessionNotFound", () => Effect.succeedNone),
              ),
            ),
            Stream.filter(Option.isSome),
            Stream.map((polled) => polled.value),
            // Only send items that changed since the previous update on this stream.
            Stream.mapAccum(
              (): Sent => new Map(),
              (sent, { header, assignment, items }) => {
                const { next, order, upserts } = diffItems(sent, items);
                const update = SubagentUpdate.make({
                  header,
                  assignment,
                  order,
                  upserts,
                });
                return [next, [update]] as const;
              },
            ),
          );
        }),

        close: Effect.fn("Subagents.close")(function* (
          sessionId: string,
          agentId: string,
        ) {
          yield* known(sessionId, agentId);
          const closedAt = yield* Clock.currentTimeMillis;
          yield* sql`
            INSERT INTO closed_subagents ${sql.insert({ sessionId, agentId, closedAt })}
            ON CONFLICT DO NOTHING
          `.pipe(Effect.orDie);
          yield* SubscriptionRef.update(closings, (n) => n + 1);
        }),

        reopen: Effect.fn("Subagents.reopen")(function* (
          sessionId: string,
          agentId: string,
        ) {
          yield* known(sessionId, agentId);
          yield* sql`
            DELETE FROM closed_subagents
            WHERE session_id = ${sessionId} AND agent_id = ${agentId}
          `.pipe(Effect.orDie);
          yield* SubscriptionRef.update(closings, (n) => n + 1);
        }),
      });
    }),
  );
}
