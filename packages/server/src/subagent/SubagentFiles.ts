import { LIVE_WINDOW_MS } from "@repo/api";
import {
  Clock,
  Config,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
} from "effect";
import { homedir } from "node:os";

// What Claude Code keeps on disk about a Session's Subagents, beside the Session's transcript:
// `<config>/projects/<project>/<sessionId>/subagents/agent-<agentId>.{jsonl,meta.json}`. The Agent
// SDK reads the transcripts but not the metadata, so it is read here. Both are undocumented
// formats (seen in Claude Code 2.1.x), so the metadata is read defensively: every field optional,
// and a file that can't be read is left out.

// One Subagent's metadata, as Claude Code wrote it when the Subagent started.
export interface SubagentMetadata {
  readonly agentId: string;
  // E.g. "Explore" or "general-purpose".
  readonly agentType?: string;
  readonly description?: string;
  // The id of the Agent call that started it, in its parent's transcript.
  readonly toolUseId?: string;
  // 1 for a Subagent of the Session itself, 2 for one a Subagent started, and so on.
  readonly spawnDepth?: number;
  // The Subagent that started it, for one started by another Subagent.
  readonly parentAgentId?: string;
  // Whether it was started in the background.
  readonly background?: boolean;
}

const decodeMetadata = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      agentType: Schema.optional(Schema.String),
      description: Schema.optional(Schema.String),
      toolUseId: Schema.optional(Schema.String),
      spawnDepth: Schema.optional(Schema.Finite),
      parentAgentId: Schema.optional(Schema.String),
      requestShape: Schema.optional(Schema.String),
    }),
  ),
);

const META = /^agent-(.+)\.meta\.json$/;
const TRANSCRIPT = /^agent-(.+)\.jsonl$/;

// Whether a transcript was written so lately that whatever writes it may still be at work.
export const isJustWritten = (mtime: number | undefined, nowMs: number) =>
  mtime !== undefined && nowMs - mtime < LIVE_WINDOW_MS;

export class SubagentFiles extends Context.Service<
  SubagentFiles,
  {
    // The folder holding the Session's Subagent files, if it has any.
    folder(sessionId: string): Effect.Effect<Option.Option<string>>;
    // The metadata of each of the Session's Subagents that has it, nested ones included.
    metadata(sessionId: string): Effect.Effect<ReadonlyArray<SubagentMetadata>>;
    // When each of the Session's Subagent transcripts was last written, in epoch millis, by agent id.
    writtenAt(sessionId: string): Effect.Effect<ReadonlyMap<string, number>>;
    // A key that changes whenever one of the Session's Subagent files is written, added or removed,
    // or a transcript stops counting as just written.
    stamp(sessionId: string): Effect.Effect<string>;
  }
>()("@repo/server/subagent/SubagentFiles") {
  static readonly layer = Layer.effect(
    SubagentFiles,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const defaultDir = path.join(homedir(), ".claude");

      // Claude Code's config folder, which the Agent SDK reads transcripts from too.
      const configDir = Config.NonEmptyString("CLAUDE_CONFIG_DIR").pipe(
        Config.withDefault(defaultDir),
      );

      // Which project folder holds the Session isn't recorded anywhere the SDK exposes, so each is
      // looked in.
      const folder = Effect.fn("SubagentFiles.folder")(
        function* (sessionId: string) {
          const projects = path.join(yield* configDir, "projects");
          for (const project of yield* fs.readDirectory(projects)) {
            const dir = path.join(projects, project, sessionId, "subagents");
            if (yield* fs.exists(dir)) return Option.some(dir);
          }
          return Option.none<string>();
        },
        Effect.orElseSucceed(() => Option.none<string>()),
      );

      const readOne = (dir: string, name: string) => {
        const agentId = META.exec(name)?.[1];
        if (agentId === undefined) return Effect.succeedNone;
        return fs.readFileString(path.join(dir, name)).pipe(
          Effect.map((text) =>
            Option.map(decodeMetadata(text), (m): SubagentMetadata => ({
              agentId,
              agentType: m.agentType,
              description: m.description,
              toolUseId: m.toolUseId,
              spawnDepth: m.spawnDepth,
              parentAgentId: m.parentAgentId,
              background:
                m.requestShape === undefined
                  ? undefined
                  : m.requestShape === "background",
            })),
          ),
          Effect.orElseSucceed(() => Option.none<SubagentMetadata>()),
        );
      };

      const metadata = Effect.fn("SubagentFiles.metadata")(function* (
        sessionId: string,
      ) {
        const dir = yield* folder(sessionId);
        if (Option.isNone(dir)) return [];
        const names = yield* fs
          .readDirectory(dir.value)
          .pipe(Effect.orElseSucceed((): Array<string> => []));
        const read = yield* Effect.forEach(names, (name) =>
          readOne(dir.value, name),
        );
        return read.flatMap((m) => (Option.isSome(m) ? [m.value] : []));
      });

      // Each of the Session's Subagent files, with when it was last written and its size.
      const files = Effect.fn("SubagentFiles.files")(
        function* (sessionId: string) {
          const dir = yield* folder(sessionId);
          if (Option.isNone(dir)) return [];
          const names = yield* fs.readDirectory(dir.value);
          return yield* Effect.forEach(names.toSorted(), (name) =>
            fs.stat(path.join(dir.value, name)).pipe(
              Effect.map((info) => ({
                name,
                mtime: Option.getOrUndefined(info.mtime)?.getTime(),
                size: info.size,
              })),
              Effect.orElseSucceed(() => ({
                name,
                mtime: undefined,
                size: undefined,
              })),
            ),
          );
        },
        Effect.orElseSucceed(() => []),
      );

      const writtenAt = Effect.fn("SubagentFiles.writtenAt")(function* (
        sessionId: string,
      ) {
        const written = new Map<string, number>();
        for (const { name, mtime } of yield* files(sessionId)) {
          const agentId = TRANSCRIPT.exec(name)?.[1];
          if (agentId !== undefined && mtime !== undefined)
            written.set(agentId, mtime);
        }
        return written;
      });

      const stamp = Effect.fn("SubagentFiles.stamp")(function* (
        sessionId: string,
      ) {
        const now = yield* Clock.currentTimeMillis;
        return (yield* files(sessionId))
          .map(
            ({ name, mtime, size }) =>
              `${name}:${mtime}:${size}:${isJustWritten(mtime, now)}`,
          )
          .join("\n");
      });

      return SubagentFiles.of({ folder, metadata, writtenAt, stamp });
    }),
  );
}
