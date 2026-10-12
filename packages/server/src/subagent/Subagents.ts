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
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Predicate,
  Schedule,
  Stream,
} from "effect";
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

// The Agent calls in the transcripts read, by the agent they started and by their own id.
interface Calls {
  readonly byAgent: Map<string, SubagentItem>;
  readonly byCall: Map<string, SubagentItem>;
}

const collectCalls = (items: ReadonlyArray<TranscriptItem>, calls: Calls) => {
  for (const item of items) {
    if (item._tag !== "Subagent") continue;
    calls.byCall.set(item.callId, item);
    if (item.agentId !== undefined) calls.byAgent.set(item.agentId, item);
  }
};

// The Assignment is the Subagent's first message; its work is everything after it.
const assignmentOf = (messages: ReadonlyArray<StoredMessage>) => {
  const [first] = messages;
  return first?.type === "user" ? promptText(first) : "";
};
const workOf = (messages: ReadonlyArray<StoredMessage>) =>
  messages[0]?.type === "user" ? messages.slice(1) : messages;

// What the Subagent's tab says of it. Without metadata, its type and description come from its
// Agent call, else "Subagent" and the first line of its Assignment.
const summarize = (
  { agentId, messages, metadata }: Transcript,
  calls: Calls,
) => {
  const call =
    calls.byAgent.get(agentId) ??
    (metadata?.toolUseId === undefined
      ? undefined
      : calls.byCall.get(metadata.toolUseId));
  const startedAt = messages.find((m) => m.timestamp)?.timestamp;
  return {
    agentId,
    callId: metadata?.toolUseId ?? call?.callId,
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
      undefined,
  };
};

const sessionInfo = (sessionId: string) =>
  sdk("getSessionInfo", () => getSessionInfo(sessionId)).pipe(
    Effect.filterOrFail(
      Predicate.isNotUndefined,
      () => new SessionNotFound({ id: sessionId }),
    ),
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
  }
>()("@repo/server/subagent/Subagents") {
  static readonly layer = Layer.effect(
    Subagents,
    Effect.gen(function* () {
      const files = yield* SubagentFiles;
      const turns = yield* Turns;

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
        const read = yield* Effect.forEach(
          ids,
          (id) => readSubagent(sessionId, id, session.metadata),
          { concurrency: 4 },
        );
        // A Subagent whose first message isn't written yet shows on a later poll.
        const started = read.filter((t) => t.messages.length > 0);
        const calls: Calls = { byAgent: new Map(), byCall: new Map() };
        collectCalls(buildItems(session.messages, context), calls);
        for (const t of started)
          collectCalls(buildItems(workOf(t.messages), context), calls);
        return started
          .map((t) => SubagentSummary.make(summarize(t, calls)))
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
        const calls: Calls = { byAgent: new Map(), byCall: new Map() };
        collectCalls(buildItems(session.messages, context), calls);
        // A nested Subagent's Agent call is in the transcript of the Subagent that started it.
        const parentId = summarize(own, calls).parentAgentId;
        if (parentId !== undefined) {
          const parent = yield* readSubagent(
            sessionId,
            parentId,
            session.metadata,
          );
          collectCalls(buildItems(workOf(parent.messages), context), calls);
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
          return changes(sessionId).pipe(
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
          yield* sessionInfo(sessionId);
          const ids = yield* sdk("listSubagents", () =>
            listSubagents(sessionId),
          );
          if (!ids.includes(agentId))
            return yield* new SubagentNotFound({ sessionId, agentId });
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
      });
    }),
  );
}
