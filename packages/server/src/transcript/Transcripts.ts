import {
  getSessionInfo,
  getSessionMessages,
  listSessions,
} from "@anthropic-ai/claude-agent-sdk";
import {
  SessionNotFound,
  SessionRef,
  TranscriptError,
  TranscriptUpdate,
} from "@repo/api";
import { Context, Effect, Layer, Predicate, Schedule, Stream } from "effect";
import { buildView } from "./View";

// Reads Claude Code transcripts through the Agent SDK, which honours CLAUDE_CONFIG_DIR.

const sdk = <A>(name: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new TranscriptError({ message: `${name}: ${String(cause)}` }),
  });

export class Transcripts extends Context.Service<
  Transcripts,
  {
    // The Session whose transcript was written to most recently, across every project.
    readonly current: Effect.Effect<
      SessionRef,
      SessionNotFound | TranscriptError
    >;
    // The Session's transcript as a stream of updates, re-read whenever the file changes.
    live(
      id: string,
    ): Effect.Effect<
      Stream.Stream<TranscriptUpdate, TranscriptError>,
      SessionNotFound | TranscriptError
    >;
  }
>()("@repo/server/transcript/Transcripts") {
  static readonly layer = Layer.succeed(Transcripts, {
    current: sdk("listSessions", () => listSessions({ limit: 1 })).pipe(
      Effect.map(([newest]) => newest),
      Effect.filterOrFail(
        Predicate.isNotUndefined,
        () => new SessionNotFound({}),
      ),
      Effect.map((newest) => SessionRef.make({ id: newest.sessionId })),
      Effect.withSpan("Transcripts.current"),
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
        info,
        Schedule.spaced("400 millis"),
      ).pipe(
        Stream.catchTag("SessionNotFound", () => Stream.empty),
        Stream.changesWith(
          (a, b) =>
            a.lastModified === b.lastModified && a.fileSize === b.fileSize,
        ),
        Stream.mapEffect((latest) =>
          sdk("getSessionMessages", () => getSessionMessages(id)).pipe(
            Effect.map((messages) => buildView(latest, messages)),
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
}
