import {
  getSessionInfo,
  getSessionMessages,
  listSessions,
  type SDKSessionInfo,
} from "@anthropic-ai/claude-agent-sdk";
import {
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
  Predicate,
  Schedule,
  Stream,
} from "effect";
import { sdk } from "../agentSdk";
import { Turns } from "../turn/Turns";
import { buildView } from "./View";

// Reads Claude Code transcripts through the Agent SDK, which honours CLAUDE_CONFIG_DIR.

// Groups Sessions by working directory. The SDK lists newest first, so each Project's Sessions
// and the Projects themselves come out most recently active first.
const toProjects = (infos: ReadonlyArray<SDKSessionInfo>) => {
  const byPath = new Map<string, Array<SessionSummary>>();
  for (const info of infos) {
    const path = info.cwd ?? "";
    const sessions = byPath.get(path) ?? [];
    sessions.push(
      SessionSummary.make({
        id: info.sessionId,
        title: info.customTitle ?? info.summary,
        gitBranch: info.gitBranch,
        lastActivityAt: DateTime.makeUnsafe(info.lastModified),
      }),
    );
    byPath.set(path, sessions);
  }
  return Array.from(byPath, ([path, sessions]) =>
    Project.make({ path, sessions }),
  );
};

// What the sidebar shows of a Session; a change to any of it means the list should be re-sent.
const listingKey = (infos: ReadonlyArray<SDKSessionInfo>) =>
  infos
    .map(
      (i) =>
        `${i.sessionId}:${i.lastModified}:${i.customTitle ?? i.summary}:${i.gitBranch}`,
    )
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

        // Headless SDK sessions are left out, matching Claude Code's own /resume picker.
        projects: Stream.fromEffectSchedule(
          sdk("listSessions", () =>
            listSessions({ includeProgrammatic: false }),
          ),
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
            Effect.all({ latest: info, hostedTurn: turns.turn(id) }),
            Schedule.spaced("400 millis"),
          ).pipe(
            Stream.catchTag("SessionNotFound", () => Stream.empty),
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
