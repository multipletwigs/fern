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
  Exit,
  Layer,
  Option,
  Order,
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
  mayBeInToolCall,
  type SubagentMetadata,
  SubagentFiles,
} from "./SubagentFiles";
import { awaitsTool, handBackOf, statsOf } from "./SubagentWork";

// A Session's Subagents, read through the Agent SDK, which honours CLAUDE_CONFIG_DIR, with what
// Claude Code keeps beside their transcripts. Each one's Agent call, in the transcript of the
// Session or of the Subagent that started it, says how it went; its own transcript says whether it
// handed back.

type SubagentItem = Extract<TranscriptItem, { _tag: "Subagent" }>;

// One Subagent's transcript, as read, and the items of its work.
interface Transcript {
  readonly agentId: string;
  readonly messages: ReadonlyArray<StoredMessage>;
  readonly metadata: SubagentMetadata | undefined;
  readonly work: ReadonlyArray<TranscriptItem>;
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
}

// The Session's transcript and its Subagents, read at once.
export interface SessionRead {
  readonly info: SDKSessionInfo;
  readonly messages: ReadonlyArray<StoredMessage>;
  // What Claude Code recorded of the Session's Subagents beside its transcript.
  readonly metadata: ReadonlyArray<SubagentMetadata>;
  // The Subagents, or why their files couldn't be read.
  readonly census: Exit.Exit<Census, TranscriptError>;
}

// Where a Subagent stands, given what its Agent call says (`running` while it says nothing yet),
// whether it handed back, and whether it may still be at work.
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

const settleWith = (items: ReadonlyArray<TranscriptItem>, census: Census) =>
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

// Agent call rows with their status settled the same way as the Subagents' tabs, and Hand-back
// rows in the Subagent's own words, without the frame the harness may add when it delivers them.
// Left as the transcript says when the Subagents couldn't be read.
export const settleRows = (
  items: ReadonlyArray<TranscriptItem>,
  { census }: SessionRead,
) => (Exit.isSuccess(census) ? settleWith(items, census.value) : items);

// The Assignment is the Subagent's first message; its work is everything after it.
const assignmentOf = (messages: ReadonlyArray<StoredMessage>) => {
  const [first] = messages;
  return first?.type === "user" ? promptText(first) : "";
};
const workOf = (messages: ReadonlyArray<StoredMessage>) =>
  messages[0]?.type === "user" ? messages.slice(1) : messages;

// When the Subagent started: its first message's time. A timestamp that can't be read says no
// more than none.
const startOf = (messages: ReadonlyArray<StoredMessage>) => {
  for (const { timestamp } of messages) {
    const time = timestamp === undefined ? undefined : DateTime.make(timestamp);
    if (time !== undefined && Option.isSome(time)) return time.value;
  }
  return undefined;
};

// What the Subagent says of itself. Without metadata, its type and description come from its
// Agent call, else "Subagent" and the first line of its Assignment.
const summarize = (transcript: Transcript, census: Census) => {
  const { agentId, messages, metadata } = transcript;
  const { calls } = census;
  const call = callOf(transcript, calls);
  const callId = metadata?.toolUseId ?? call?.callId;
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
    startedAt: startOf(messages),
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

// The order Subagents started in: those whose start isn't known last, ties by agent id.
const byStart: Order.Order<SubagentSummary> = (a, b) =>
  Order.Boolean(a.startedAt === undefined, b.startedAt === undefined) ||
  (a.startedAt && b.startedAt ? DateTime.Order(a.startedAt, b.startedAt) : 0) ||
  Order.String(a.agentId, b.agentId);

// How many Sessions' reads are kept: those open in a window, give or take.
const KEPT_READS = 8;

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
    // The Session's transcript and its Subagents, shared by every stream on the Session: re-read
    // only once one of their files, or a turn Fern runs on it, changed since the last read.
    read(
      sessionId: string,
    ): Effect.Effect<SessionRead, SessionNotFound | TranscriptError>;
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
      const noteClosing = (_sessionId: string) =>
        SubscriptionRef.update(closings, (n) => n + 1);
      const closingsOf = (_sessionId: string) =>
        SubscriptionRef.changes(closings);

      const closedOf = (sessionId: string) =>
        sql<{ agentId: string }>`
          SELECT agent_id FROM closed_subagents WHERE session_id = ${sessionId}
        `.pipe(
          Effect.map((rows) => new Set(rows.map((row) => row.agentId))),
          Effect.orDie,
        );

      // The Session's info, and a key that changes whenever its transcript or one of its Subagent
      // files changes or goes quiet, or a turn Fern runs or its process starts or ends.
      const keyOf = Effect.fn("Subagents.keyOf")(function* (sessionId: string) {
        const { info, stamp, turn, open, now } = yield* Effect.all({
          info: sessionInfo(sessionId),
          stamp: files.stamp(sessionId),
          turn: turns.turn(sessionId),
          open: turns.isOpen(sessionId),
          now: Clock.currentTimeMillis,
        });
        const written = info.lastModified;
        return {
          info,
          key: `${written}:${info.fileSize}:${isJustWritten(written, now)}:${mayBeInToolCall(written, now)}:${turn?.running}:${open}:${stamp}`,
        };
      });

      // Ticks whenever the key changes. A poll that misses the transcript skips a beat.
      const changes = (sessionId: string) =>
        Stream.fromEffectSchedule(
          keyOf(sessionId).pipe(
            Effect.map(({ key }) => Option.some(key)),
            Effect.catchTag("SessionNotFound", () => Effect.succeedNone),
          ),
          Schedule.spaced("400 millis"),
        ).pipe(
          Stream.filter(Option.isSome),
          Stream.map((key) => key.value),
          Stream.changes,
        );

      // Every Subagent of the Session, given its own transcript, and where each one stands.
      const survey = Effect.fn("Subagents.survey")(function* (
        info: SDKSessionInfo,
        messages: ReadonlyArray<StoredMessage>,
        metadata: ReadonlyArray<SubagentMetadata>,
      ): Effect.fn.Return<Census, TranscriptError> {
        const { sessionId } = info;
        const { written, turn, open, now } = yield* Effect.all({
          written: files.writtenAt(sessionId),
          turn: turns.turn(sessionId),
          open: turns.isOpen(sessionId),
          now: Clock.currentTimeMillis,
        });
        const context = { cwd: info.cwd ?? "", subagents: metadata };
        const ids = yield* sdk("listSubagents", () => listSubagents(sessionId));
        const transcripts = yield* Effect.forEach(
          ids,
          (agentId) =>
            sdk("getSubagentMessages", () =>
              getSubagentMessages(sessionId, agentId),
            ).pipe(Effect.map((own) => ({ agentId, own }))),
          { concurrency: 4 },
        );
        // A Subagent whose first message isn't written yet shows on a later poll.
        const started = transcripts.flatMap(
          ({ agentId, own }): Array<Transcript> =>
            own.length === 0
              ? []
              : [
                  {
                    agentId,
                    messages: own,
                    metadata: metadata.find((m) => m.agentId === agentId),
                    work: buildItems(workOf(own), context),
                  },
                ],
        );
        // A nested Subagent's Agent call is in the transcript of the Subagent that started it.
        const calls = noCalls();
        collectCalls(buildItems(messages, context), calls);
        for (const t of started) collectCalls(t.work, calls, t.agentId);

        const turnRunning = turn?.running === true;
        // Whether a tool call a Subagent waits on may still run: for a Hosted Session, while
        // Fern's turn runs or its process is open; for an External one, while one of the
        // Session's files was written lately enough. Any of them being written means its Claude
        // Code process is alive.
        const alive =
          turn === undefined
            ? mayBeInToolCall(
                Math.max(info.lastModified, ...written.values()),
                now,
              )
            : turnRunning || open;
        const standings = new Map<string, Standing>();
        for (const t of started) {
          const said = callOf(t, calls)?.status ?? "running";
          const atWork =
            turnRunning ||
            isJustWritten(written.get(t.agentId), now) ||
            (alive && awaitsTool(t.messages));
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
        };
      });

      const load = Effect.fn("Subagents.load")(function* (
        info: SDKSessionInfo,
      ) {
        const { sessionId } = info;
        const [messages, metadata] = yield* Effect.all(
          [
            sdk("getSessionMessages", () => getSessionMessages(sessionId)),
            files.metadata(sessionId),
          ],
          { concurrency: 2 },
        );
        // Subagent files are an undocumented format, so a defect reading them is theirs.
        const census = yield* survey(info, messages, metadata).pipe(
          Effect.catchDefect((defect) =>
            Effect.fail(new TranscriptError({ message: String(defect) })),
          ),
          Effect.tapError((error) =>
            Effect.logWarning("Subagents unread", sessionId, error.message),
          ),
          Effect.exit,
        );
        return { info, messages, metadata, census } satisfies SessionRead;
      });

      // The latest read of each Session, by the key it was read at, most recently read last.
      const reads = new Map<
        string,
        {
          readonly key: string;
          readonly read: Effect.Effect<SessionRead, TranscriptError>;
        }
      >();
      const read = Effect.fn("Subagents.read")(function* (sessionId: string) {
        const { info, key } = yield* keyOf(sessionId);
        const kept = reads.get(sessionId);
        if (kept?.key === key) return yield* kept.read;
        const fresh = yield* Effect.cached(load(info));
        reads.delete(sessionId);
        reads.set(sessionId, { key, read: fresh });
        for (const id of reads.keys())
          if (reads.size > KEPT_READS) reads.delete(id);
        return yield* fresh;
      });

      const summaries = Effect.fn("Subagents.summaries")(function* (
        sessionId: string,
      ) {
        const census = yield* (yield* read(sessionId)).census;
        const closed = yield* closedOf(sessionId);
        return census.started
          .map((t) =>
            SubagentSummary.make({
              ...summarize(t, census),
              closed: closed.has(t.agentId),
            }),
          )
          .toSorted(byStart);
      });

      const view = Effect.fn("Subagents.view")(function* (
        sessionId: string,
        agentId: string,
      ) {
        const { census: surveyed, metadata } = yield* read(sessionId);
        const census = yield* surveyed;
        // One whose first message isn't written yet has nothing to show but its header.
        const own = census.started.find((t) => t.agentId === agentId) ?? {
          agentId,
          messages: [],
          metadata: metadata.find((m) => m.agentId === agentId),
          work: [],
        };
        return {
          header: SubagentHeader.make({
            ...summarize(own, census),
            ...statsOf(own.messages),
          }),
          handBack: census.standings.get(agentId)?.handBack,
          assignment: assignmentOf(own.messages),
          items: settleWith(own.work, census),
        };
      });

      return Subagents.of({
        list: Effect.fn("Subagents.list")(function* (sessionId: string) {
          yield* sessionInfo(sessionId);
          return Stream.zipLatest(
            changes(sessionId),
            closingsOf(sessionId),
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

        read,

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
          yield* noteClosing(sessionId);
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
          yield* noteClosing(sessionId);
        }),
      });
    }),
  );
}
