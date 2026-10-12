import {
  getSessionInfo,
  getSessionMessages,
  listSessions,
  type SDKSessionInfo,
} from "@anthropic-ai/claude-agent-sdk";
import {
  type HostedTurn,
  Project,
  SessionNotFound,
  SessionRef,
  SessionSummary,
  TranscriptError,
  TranscriptUpdate,
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
import { HostedSessions, type HostedWorktree } from "../turn/HostedSessions";
import { Turns } from "../turn/Turns";
import { buildView } from "./View";

// Reads Claude Code transcripts through the Agent SDK, which honours CLAUDE_CONFIG_DIR.

// Groups Sessions by Project: the folder they ran in, or for a Session in a worktree Fern made, the
// folder it was started from. The SDK lists newest first, so each Project's Sessions and the
// Projects themselves come out most recently active first.
type TurnsById = ReadonlyMap<string, HostedTurn>;

interface Listing {
  readonly infos: ReadonlyArray<SDKSessionInfo>;
  readonly turns: TurnsById;
  readonly worktrees: ReadonlyArray<HostedWorktree>;
}

// The worktree Fern made that the Session ran in, if any. Another Session run there, such as one in
// a terminal, belongs to the same Project.
const worktreeOf = (
  worktrees: ReadonlyArray<HostedWorktree>,
  info: SDKSessionInfo,
) => {
  const cwd = info.cwd ?? "";
  return (
    worktrees.find((w) => w.id === info.sessionId) ??
    worktrees.find((w) => cwd === w.cwd || cwd.startsWith(`${w.cwd}/`))
  );
};

const toProjects = ({ infos, turns, worktrees }: Listing) => {
  const byPath = new Map<string, Array<SessionSummary>>();
  for (const info of infos) {
    const worktree = worktreeOf(worktrees, info);
    const path = worktree?.projectRoot ?? info.cwd ?? "";
    const sessions = byPath.get(path) ?? [];
    sessions.push(
      SessionSummary.make({
        id: info.sessionId,
        title: info.customTitle ?? info.summary,
        gitBranch: info.gitBranch ?? worktree?.branch,
        worktree: worktree ? (info.cwd ?? worktree.cwd) : undefined,
        lastActivityAt: DateTime.makeUnsafe(info.lastModified),
        hostedTurn: turns.get(info.sessionId),
      }),
    );
    byPath.set(path, sessions);
  }
  return Array.from(byPath, ([path, sessions]) =>
    Project.make({ path, sessions }),
  );
};

// What the sidebar shows of a Session; a change to any of it means the list should be re-sent.
const listingKey = ({ infos, turns, worktrees }: Listing) =>
  infos
    .map((i) => {
      const turn = turns.get(i.sessionId);
      return `${i.sessionId}:${i.lastModified}:${i.customTitle ?? i.summary}:${i.gitBranch}:${worktreeOf(worktrees, i)?.projectRoot}:${turn?.running}:${turn?.endedAt?.epochMilliseconds}`;
    })
    .join("\n");

export class Transcripts extends Context.Service<
  Transcripts,
  {
    // The Session whose transcript was written to most recently, across every project.
    readonly current: Effect.Effect<
      SessionRef,
      SessionNotFound | TranscriptError
    >;
    // Every Project, re-sent whenever a Session starts, changes, or is renamed.
    readonly projects: Stream.Stream<ReadonlyArray<Project>, TranscriptError>;
    // The Session's transcript as a stream of updates, re-read whenever the file changes.
    live(
      id: string,
    ): Effect.Effect<
      Stream.Stream<TranscriptUpdate, TranscriptError>,
      SessionNotFound | TranscriptError
    >;
  }
>()("@repo/server/transcript/Transcripts") {
  static readonly layer = Layer.effect(
    Transcripts,
    Effect.gen(function* () {
      const turns = yield* Turns;
      const sessions = yield* HostedSessions;
      return Transcripts.of({
        current: sdk("listSessions", () => listSessions({ limit: 1 })).pipe(
          Effect.map(([newest]) => newest),
          Effect.filterOrFail(
            Predicate.isNotUndefined,
            () => new SessionNotFound({}),
          ),
          Effect.map((newest) => SessionRef.make({ id: newest.sessionId })),
          Effect.withSpan("Transcripts.current"),
        ),

        // Other scripts' headless Sessions are left out, matching Claude Code's own /resume picker.
        // Each Session goes with the latest turn Fern ran on it, so a stopped turn stops showing as
        // live without waiting out the live window.
        projects: Stream.fromEffectSchedule(
          Effect.gen(function* () {
            const infos = yield* sessions.listed;
            const hosted = yield* Effect.forEach(infos, (info) =>
              turns
                .turn(info.sessionId)
                .pipe(Effect.map((turn) => [info.sessionId, turn] as const)),
            );
            const byId = new Map<string, HostedTurn>();
            for (const [id, turn] of hosted) if (turn) byId.set(id, turn);
            const worktrees = yield* sessions.worktrees;
            return { infos, turns: byId, worktrees };
          }),
          Schedule.spaced("2 seconds"),
        ).pipe(
          Stream.changesWith((a, b) => listingKey(a) === listingKey(b)),
          Stream.map(toProjects),
        ),

        live: Effect.fn("Transcripts.live")(function* (id: string) {
          const info = sdk("getSessionInfo", () => getSessionInfo(id)).pipe(
            Effect.filterOrFail(
              Predicate.isNotUndefined,
              () => new SessionNotFound({ id }),
            ),
          );
          yield* info;

          return Stream.fromEffectSchedule(
            Effect.all({ latest: info, hostedTurn: turns.turn(id) }).pipe(
              // A poll that misses the file (the SDK returns undefined on any read error) skips a
              // beat. Ending the stream would leave the page on its last header.
              Effect.asSome,
              Effect.catchTag("SessionNotFound", () => Effect.succeedNone),
            ),
            Schedule.spaced("400 millis"),
          ).pipe(
            Stream.filter(Option.isSome),
            Stream.map((polled) => polled.value),
            // Re-read when the transcript changes or a turn Fern runs starts or ends.
            Stream.changesWith(
              (a, b) =>
                a.latest.lastModified === b.latest.lastModified &&
                a.latest.fileSize === b.latest.fileSize &&
                a.hostedTurn === b.hostedTurn,
            ),
            Stream.mapEffect(({ latest, hostedTurn }) =>
              sdk("getSessionMessages", () => getSessionMessages(id)).pipe(
                Effect.map((messages) =>
                  buildView(latest, messages, hostedTurn),
                ),
              ),
            ),
            // Only send items that changed since the previous update on this stream.
            Stream.mapAccum(
              () => new Map<string, string>(),
              (sent, { header, items }) => {
                const next = new Map(
                  items.map((item) => [item.id, JSON.stringify(item)]),
                );
                const update = TranscriptUpdate.make({
                  header,
                  order: items.map((item) => item.id),
                  upserts: items.filter(
                    (item) => sent.get(item.id) !== next.get(item.id),
                  ),
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
