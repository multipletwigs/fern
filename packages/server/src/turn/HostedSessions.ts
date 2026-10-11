import {
  listSessions,
  type SDKSessionInfo,
} from "@anthropic-ai/claude-agent-sdk";
import type { TranscriptError } from "@repo/api";
import { Clock, Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { sdk } from "../agentSdk";

// The Sessions Fern lists: the ones the developer ran, as Claude Code's own /resume picker shows
// them, plus the ones Fern started itself. Claude Code records Fern's as headless SDK Sessions,
// which /resume leaves out along with every other script's, so Fern keeps its own record of them.
export class HostedSessions extends Context.Service<
  HostedSessions,
  {
    // Remembers a Session Fern started, so it's listed from then on.
    record(id: string, cwd: string): Effect.Effect<void>;
    // Every listed Session, most recently active first.
    readonly listed: Effect.Effect<
      ReadonlyArray<SDKSessionInfo>,
      TranscriptError
    >;
    // Whether a listed Session ran in the folder, which is what makes it a Project.
    isProject(cwd: string): Effect.Effect<boolean, TranscriptError>;
  }
>()("@repo/server/turn/HostedSessions") {
  static readonly layer = Layer.effect(
    HostedSessions,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const startedIds = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({ id: Schema.String }),
        execute: () => sql`SELECT id FROM hosted_sessions`,
      });

      const record = Effect.fn("HostedSessions.record")(function* (
        id: string,
        cwd: string,
      ) {
        const startedAt = yield* Clock.currentTimeMillis;
        yield* sql`INSERT OR IGNORE INTO hosted_sessions ${sql.insert({ id, cwd, startedAt })}`;
      }, Effect.orDie);

      const listed = Effect.gen(function* () {
        const [developers, started] = yield* Effect.all(
          [
            sdk("listSessions", () =>
              listSessions({ includeProgrammatic: false }),
            ),
            startedIds().pipe(Effect.orDie),
          ],
          { concurrency: "unbounded" },
        );
        if (started.length === 0) return developers;
        const ids = new Set(started.map((row) => row.id));
        const shown = new Set(developers.map((info) => info.sessionId));
        const everything = yield* sdk("listSessions", () => listSessions());
        return [
          ...developers,
          ...everything.filter(
            (info) => ids.has(info.sessionId) && !shown.has(info.sessionId),
          ),
        ].toSorted((a, b) => b.lastModified - a.lastModified);
      }).pipe(Effect.withSpan("HostedSessions.listed"));

      const isProject = (cwd: string) =>
        listed.pipe(
          Effect.map((sessions) => sessions.some((info) => info.cwd === cwd)),
        );

      return HostedSessions.of({ record, listed, isProject });
    }),
  );
}
