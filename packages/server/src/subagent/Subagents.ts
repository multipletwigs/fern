import {
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  listSubagents,
  type SDKSessionInfo,
} from "@anthropic-ai/claude-agent-sdk";
import {
  SessionNotFound,
  SubagentHeader,
  SubagentNotFound,
  type SubagentStatus,
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
import {
  isJustWritten,
  type SubagentMetadata,
  SubagentFiles,
} from "./SubagentFiles";
import { handBackOf, statsOf } from "./SubagentWork";

// A Session's Subagents, read through the Agent SDK, which honours CLAUDE_CONFIG_DIR, with what
// Claude Code keeps beside their transcripts. Each one's Agent call, in the transcript of the
// Session or of the Subagent that started it, says how it went; its own transcript says whether it
// handed back.

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

// Where one started Subagent stands, from its Agent call and its own transcript.
interface Standing {
  readonly status: SubagentStatus;
  readonly handBack: string | undefined;
}

// Everything read of a Session's Subagents at once.
interface Census {
  // Those whose first message is written, in no particular order.
  readonly started: ReadonlyArray<Transcript>;
  readonly calls: Calls;
  readonly standings: ReadonlyMap<string, Standing>;
  // Whether a Subagent with no transcript yet may still be at work.
  readonly sessionAtWork: boolean;
  // What their transcripts are read into items with.
  readonly context: {
    readonly cwd: string;
    readonly subagents: ReadonlyArray<SubagentMetadata>;
  };
}

// Where a Subagent stands, given what its Agent call says (`running` while it says nothing yet),
// whether it handed back, and whether it may still be at work: a turn Fern runs on the Session is
// running, or its transcript was just written.
const settle = (
  said: SubagentStatus,
  handBack: string | undefined,
  atWork: boolean,
): SubagentStatus => {
  if (said === "failed") return "failed";
  if (said === "done" || handBack !== undefined) return "done";
  if (said === "stopped" || !atWork) return "stopped";
  return "running";
};

// Agent call rows with their status settled the same way as the Subagents' tabs, and Hand-back
// rows in the Subagent's own words, without the frame the harness may add when it delivers them.
const settleRows = (items: ReadonlyArray<TranscriptItem>, census: Census) =>
  items.map((item): TranscriptItem => {
    if (item._tag === "HandBack") {
      const text = census.standings.get(item.agentId)?.handBack;
      return text === undefined || text === item.text
        ? item
        : { ...item, text };
    }
    if (item._tag !== "Subagent") return item;
    const standing =
      item.agentId === undefined
        ? undefined
        : census.standings.get(item.agentId);
    const status =
      standing?.status ?? settle(item.status, undefined, census.sessionAtWork);
    return status === item.status ? item : { ...item, status };
  });

// The Assignment is the Subagent's first message; its work is everything after it.
const assignmentOf = (messages: ReadonlyArray<StoredMessage>) => {
  const [first] = messages;
  return first?.type === "user" ? promptText(first) : "";
};
const workOf = (messages: ReadonlyArray<StoredMessage>) =>
  messages[0]?.type === "user" ? messages.slice(1) : messages;

// What the Subagent says of itself. Without metadata, its type and description come from its
// Agent call, else "Subagent" and the first line of its Assignment.
const summarize = (transcript: Transcript, census: Census) => {
  const { agentId, messages, metadata } = transcript;
  const { calls } = census;
  const call = callOf(transcript, calls);
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
    status: census.standings.get(agentId)?.status ?? "running",
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
    // One Subagent's header, Assignment, work and Hand-back as a stream of updates, re-read
    // whenever its files or the Session's change.
    live(
      sessionId: string,
      agentId: string,
    ): Effect.Effect<
      Stream.Stream<SubagentUpdate, TranscriptError>,
      SessionNotFound | SubagentNotFound | TranscriptError
    >;
    // Items of the Session's own transcript, read from `messages`, with each Agent call's status
    // settled as its Subagent's tab shows it.
    settleRows(
      info: SDKSessionInfo,
      messages: ReadonlyArray<StoredMessage>,
      items: ReadonlyArray<TranscriptItem>,
    ): Effect.Effect<ReadonlyArray<TranscriptItem>, TranscriptError>;
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

      // Ticks whenever the Session's transcript or one of its Subagent files changes or goes
      // quiet, or a turn Fern runs starts or ends. A poll that misses the transcript skips a beat.
      const changes = (sessionId: string) =>
        Stream.fromEffectSchedule(
          Effect.all({
            latest: sdk("getSessionInfo", () => getSessionInfo(sessionId)),
            stamp: files.stamp(sessionId),
            turn: turns.turn(sessionId),
            now: Clock.currentTimeMillis,
          }).pipe(
            Effect.map(({ latest, stamp, turn, now }) =>
              latest
                ? `${latest.lastModified}:${latest.fileSize}:${isJustWritten(latest.lastModified, now)}:${turn?.running}:${stamp}`
                : undefined,
            ),
          ),
          Schedule.spaced("400 millis"),
        ).pipe(Stream.filter(Predicate.isNotUndefined), Stream.changes);

      // Every Subagent of the Session, given its own transcript, and where each one stands.
      const survey = Effect.fn("Subagents.survey")(function* (
        info: SDKSessionInfo,
        messages: ReadonlyArray<StoredMessage>,
      ): Effect.fn.Return<Census, TranscriptError> {
        const { sessionId } = info;
        const { metadata, written, turn, now } = yield* Effect.all({
          metadata: files.metadata(sessionId),
          written: files.writtenAt(sessionId),
          turn: turns.turn(sessionId),
          now: Clock.currentTimeMillis,
        });
        const context = { cwd: info.cwd ?? "", subagents: metadata };
        const ids = yield* sdk("listSubagents", () => listSubagents(sessionId));
        const read = yield* Effect.forEach(
          ids,
          (id) => readSubagent(sessionId, id, metadata),
          { concurrency: 4 },
        );
        // A Subagent whose first message isn't written yet shows on a later poll.
        const started = read.filter((t) => t.messages.length > 0);
        // A nested Subagent's Agent call is in the transcript of the Subagent that started it.
        const calls = noCalls();
        collectCalls(buildItems(messages, context), calls);
        for (const t of started)
          collectCalls(
            buildItems(workOf(t.messages), context),
            calls,
            t.agentId,
          );

        const turnRunning = turn?.running === true;
        const standings = new Map<string, Standing>();
        for (const t of started) {
          const said = callOf(t, calls)?.status ?? "running";
          const atWork =
            turnRunning || isJustWritten(written.get(t.agentId), now);
          // Text it ended on is only its Hand-back once it's done writing.
          const handBack = handBackOf(
            t.messages,
            said !== "running" || !atWork,
          );
          standings.set(t.agentId, {
            status: settle(said, handBack, atWork),
            handBack,
          });
        }
        return {
          started,
          calls,
          standings,
          sessionAtWork: turnRunning || isJustWritten(info.lastModified, now),
          context,
        };
      });

      // The Session's own transcript, and everything read of its Subagents.
      const readSession = Effect.fn("Subagents.readSession")(function* (
        sessionId: string,
      ) {
        const info = yield* sessionInfo(sessionId);
        const messages = yield* sdk("getSessionMessages", () =>
          getSessionMessages(sessionId),
        );
        return yield* survey(info, messages);
      });

      const summaries = Effect.fn("Subagents.summaries")(function* (
        sessionId: string,
      ) {
        const census = yield* readSession(sessionId);
        const closed = yield* closedOf(sessionId);
        return census.started
          .map((t) =>
            SubagentSummary.make({
              ...summarize(t, census),
              closed: closed.has(t.agentId),
            }),
          )
          .toSorted((a, b) => startMillis(a) - startMillis(b));
      });

      const view = Effect.fn("Subagents.view")(function* (
        sessionId: string,
        agentId: string,
      ) {
        const census = yield* readSession(sessionId);
        const own =
          census.started.find((t) => t.agentId === agentId) ??
          (yield* readSubagent(sessionId, agentId, census.context.subagents));
        return {
          header: SubagentHeader.make({
            ...summarize(own, census),
            ...statsOf(own.messages),
          }),
          handBack: census.standings.get(agentId)?.handBack,
          assignment: assignmentOf(own.messages),
          items: settleRows(
            buildItems(workOf(own.messages), census.context),
            census,
          ),
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
              (sent, { header, assignment, items, handBack }) => {
                const { next, order, upserts } = diffItems(sent, items);
                const update = SubagentUpdate.make({
                  header,
                  assignment,
                  order,
                  upserts,
                  handBack,
                });
                return [next, [update]] as const;
              },
            ),
          );
        }),

        settleRows: Effect.fn("Subagents.settleRows")(function* (
          info: SDKSessionInfo,
          messages: ReadonlyArray<StoredMessage>,
          items: ReadonlyArray<TranscriptItem>,
        ) {
          return settleRows(items, yield* survey(info, messages));
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
