import {
  listSessions,
  type SDKSessionInfo,
} from "@anthropic-ai/claude-agent-sdk";
import type { TranscriptError } from "@repo/api";
import { Clock, Context, Effect, Layer, Option, Ref, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { sdk } from "../agentSdk";
import type { Worktree } from "../worktree/Worktrees";

// Where a Hosted Session runs, and the Project it belongs to.
export const HostedWorktree = Schema.Struct({
  id: Schema.String,
  cwd: Schema.String,
  projectRoot: Schema.String,
  branch: Schema.String,
});
export type HostedWorktree = typeof HostedWorktree.Type;

// The Sessions Fern lists: the ones the developer ran, as Claude Code's own /resume picker shows
// them, plus the ones Fern started itself. Claude Code records Fern's as headless SDK Sessions,
// which /resume leaves out along with every other script's, so Fern keeps its own record of them.
export class HostedSessions extends Context.Service<
  HostedSessions,
  {
    // Remembers a Session Fern started in a worktree, so it's listed from then on, under the
    // Project it was started from.
    record(id: string, worktree: Worktree): Effect.Effect<void>;
    // Every Session Fern started in a worktree.
    readonly worktrees: Effect.Effect<ReadonlyArray<HostedWorktree>>;
    // Every listed Session, most recently active first.
    readonly listed: Effect.Effect<
      ReadonlyArray<SDKSessionInfo>,
      TranscriptError
    >;
    // Whether a listed Session ran in the folder, which is what makes it a Project, or Fern started
    // one there or from there. A folder once seen as one stays one, so only a folder not yet seen
    // costs a listing.
    isProject(cwd: string): Effect.Effect<boolean, TranscriptError>;
    // Whether Fern started the Session, which makes it a Hosted Session.
    isHosted(id: string): Effect.Effect<boolean>;
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
      const worktrees = SqlSchema.findAll({
        Request: Schema.Void,
        Result: HostedWorktree,
        execute: () => sql`
          SELECT id, cwd, project_root, branch FROM hosted_sessions
          WHERE project_root IS NOT NULL AND branch IS NOT NULL`,
      })().pipe(Effect.orDie);
      const startedIn = SqlSchema.findAll({
        Request: Schema.String,
        Result: Schema.Struct({ id: Schema.String }),
        execute: (folder) => sql`
          SELECT id FROM hosted_sessions
          WHERE cwd = ${folder} OR project_root = ${folder} LIMIT 1`,
      });
      // Every folder a listing has shown a Session in. Listing reads every transcript on disk, too
      // slow to repeat on each request that names a Project.
      const projects = yield* Ref.make<ReadonlySet<string>>(new Set());
      const remember = (sessions: ReadonlyArray<SDKSessionInfo>) =>
        Ref.update(projects, (known) => {
          const next = new Set(known);
          for (const info of sessions) if (info.cwd) next.add(info.cwd);
          return next.size === known.size ? known : next;
        });

      const record = Effect.fn("HostedSessions.record")(function* (
        id: string,
        { cwd, projectRoot, branch, base, path }: Worktree,
      ) {
        const startedAt = yield* Clock.currentTimeMillis;
        yield* sql`INSERT OR IGNORE INTO hosted_sessions ${sql.insert({
          id,
          cwd,
          startedAt,
          projectRoot,
          branch,
          baseCommit: base,
          worktree: path,
        })}`;
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
        if (started.length === 0) {
          yield* remember(developers);
          return developers;
        }
        const ids = new Set(started.map((row) => row.id));
        const shown = new Set(developers.map((info) => info.sessionId));
        const everything = yield* sdk("listSessions", () => listSessions());
        const sessions = [
          ...developers,
          ...everything.filter(
            (info) => ids.has(info.sessionId) && !shown.has(info.sessionId),
          ),
        ].toSorted((a, b) => b.lastModified - a.lastModified);
        yield* remember(sessions);
        return sessions;
      }).pipe(Effect.withSpan("HostedSessions.listed"));

      const isProject = Effect.fn("HostedSessions.isProject")(function* (
        cwd: string,
      ) {
        if ((yield* Ref.get(projects)).has(cwd)) return true;
        // A Session Fern just started may not be on disk yet.
        if ((yield* startedIn(cwd).pipe(Effect.orDie)).length > 0) return true;
        yield* listed;
        return (yield* Ref.get(projects)).has(cwd);
      });

      const hostedId = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Schema.Struct({ id: Schema.String }),
        execute: (id) => sql`SELECT id FROM hosted_sessions WHERE id = ${id}`,
      });
      const isHosted = Effect.fn("HostedSessions.isHosted")(function* (
        id: string,
      ) {
        return Option.isSome(yield* hostedId(id));
      }, Effect.orDie);

      return HostedSessions.of({
        record,
        worktrees,
        listed,
        isProject,
        isHosted,
      });
    }),
  );
}
