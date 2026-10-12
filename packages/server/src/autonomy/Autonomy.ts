import {
  AUTONOMY_THRESHOLD,
  BOUNDARIES,
  Boundary,
  Milestone,
  MilestoneClosed,
  MilestoneNotFound,
  MilestoneStatus,
  type Phase,
  PHASES,
  SessionAutonomy,
} from "@repo/api";
import {
  Clock,
  Context,
  Effect,
  Layer,
  Option,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { HostedSessions } from "../turn/HostedSessions";

// What happened at a boundary, in order. A `declined` Checkpoint, a `reset` (a Milestone decided)
// or Autonomy `withdrawn` starts the streak over; `clean` passes count towards it; `approved` is a
// pass after a declined Checkpoint, and `fern` one Fern approved itself, which count for nothing.
type EventKind =
  "clean" | "approved" | "declined" | "fern" | "reset" | "withdrawn";

// How the developer redirected a Session.
export type Redirect = "message" | "rejection";

// Why an Escape withdrew Autonomy, as the developer reads it after "Autonomy withdrawn at …: ".
const ESCAPE_REASONS: Record<Redirect, string> = {
  message: "you redirected the Session after Fern approved it",
  rejection: "you rejected part of a Walkthrough after Fern approved it",
};

const MilestoneRow = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  boundary: Boundary,
  status: MilestoneStatus,
  offeredAt: Schema.Finite,
  decidedAt: Schema.NullOr(Schema.Finite),
});
type MilestoneRow = typeof MilestoneRow.Type;

const toMilestone = (row: MilestoneRow) =>
  Milestone.make({
    id: row.id,
    project: row.project,
    boundary: row.boundary,
    status: row.status,
    offeredAt: Schema.decodeSync(Schema.DateTimeUtcFromMillis)(row.offeredAt),
    decidedAt:
      row.decidedAt === null
        ? undefined
        : Schema.decodeSync(Schema.DateTimeUtcFromMillis)(row.decidedAt),
  });

const isBoundary = Schema.is(Boundary);

// Autonomy each Project earns at the two earnable boundaries, the end of Spec and the end of
// Implement. Flows reports every pass and declined Checkpoint there; AUTONOMY_THRESHOLD clean
// passes in a row offer a Milestone, and once the developer accepts it Flows asks `covers` and
// approves that boundary itself. Ending a Grill and accepting Findings are never covered.
export class Autonomy extends Context.Service<
  Autonomy,
  {
    // Whether Fern approves the end of the Phase itself, in the Session's Project.
    covers(sessionId: string, phase: Phase): Effect.Effect<boolean>;
    // The developer approved the end of the Phase: a clean pass if nothing was declined there in
    // the Session, which may offer a Milestone.
    approved(sessionId: string, phase: Phase): Effect.Effect<void>;
    // The developer declined a Checkpoint at the end of the Phase: its streak starts over.
    declined(sessionId: string, phase: Phase): Effect.Effect<void>;
    // Fern approved the end of the Phase in the Session under Autonomy.
    approvedByFern(sessionId: string, phase: Phase): Effect.Effect<void>;
    // Takes back the Project's Autonomy and any open offer at the boundary, with why (an Escape
    // slipped past it), and starts its streak over. Phases that aren't earnable are ignored.
    withdraw(
      project: string,
      boundary: Phase,
      reason: string,
    ): Effect.Effect<void>;
    // The developer redirected the Session: a message of their own, or a Walkthrough's Rejections.
    // Fern's own messages (Phase commands, Round answers, accepted Findings) are never Redirects.
    // After Fern approved a boundary in the Session and before the next Phase reports done, it is
    // an Escape there, which withdraws the boundary's Autonomy with why.
    redirected(sessionId: string, redirect: Redirect): Effect.Effect<void>;
    // The Session's Project's streaks, offers and Autonomy, with what Fern approved in the
    // Session, re-sent whenever they change; null for a Session Fern didn't start.
    autonomy(sessionId: string): Stream.Stream<SessionAutonomy | null>;
    // Grants Autonomy at the Milestone's boundary.
    accept(
      id: string,
    ): Effect.Effect<void, MilestoneNotFound | MilestoneClosed>;
    // Keeps the boundary with the developer, and starts its streak over.
    decline(
      id: string,
    ): Effect.Effect<void, MilestoneNotFound | MilestoneClosed>;
  }
>()("@repo/server/autonomy/Autonomy") {
  static readonly layer = Layer.effect(
    Autonomy,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const hosted = yield* HostedSessions;
      // Bumped after every write, so open streams reload.
      const version = yield* SubscriptionRef.make(0);
      const bump = SubscriptionRef.update(version, (n) => n + 1);

      const streakOf = SqlSchema.findOne({
        Request: Schema.Struct({ project: Schema.String, boundary: Boundary }),
        Result: Schema.Struct({ streak: Schema.Finite }),
        execute: ({ project, boundary }) => sql`
          SELECT COUNT(*) AS streak FROM autonomy_events
          WHERE project = ${project} AND boundary = ${boundary} AND kind = 'clean'
            AND seq > COALESCE((
              SELECT MAX(seq) FROM autonomy_events
              WHERE project = ${project} AND boundary = ${boundary}
                AND kind IN ('declined', 'reset', 'withdrawn')
            ), 0)`,
      });
      const sessionEvents = SqlSchema.findAll({
        Request: Schema.Struct({
          sessionId: Schema.String,
          boundary: Boundary,
        }),
        Result: Schema.Struct({ kind: Schema.String }),
        execute: ({ sessionId, boundary }) => sql`
          SELECT kind FROM autonomy_events
          WHERE session_id = ${sessionId} AND boundary = ${boundary}`,
      });
      const milestonesOf = SqlSchema.findAll({
        Request: Schema.Struct({ project: Schema.String, boundary: Boundary }),
        Result: MilestoneRow,
        execute: ({ project, boundary }) => sql`
          SELECT id, project, boundary, status, offered_at, decided_at FROM milestones
          WHERE project = ${project} AND boundary = ${boundary}
            AND status IN ('offered', 'accepted')
          ORDER BY offered_at, rowid`,
      });
      // The latest withdrawal at the boundary, unless a Milestone was decided there since.
      const withdrawalOf = SqlSchema.findOneOption({
        Request: Schema.Struct({ project: Schema.String, boundary: Boundary }),
        Result: Schema.Struct({ reason: Schema.String, at: Schema.Finite }),
        execute: ({ project, boundary }) => sql`
          SELECT reason, at FROM (
            SELECT kind, reason, at FROM autonomy_events
            WHERE project = ${project} AND boundary = ${boundary}
              AND kind IN ('reset', 'withdrawn')
            ORDER BY seq DESC LIMIT 1
          ) WHERE kind = 'withdrawn'`,
      });
      // The Session's Project, while an Escape at the boundary is possible: Fern approved it in the
      // Session, and since then the next Phase hasn't reported done (raising its Checkpoint) or been
      // skipped, the Session hasn't been archived, and no Escape has been counted there yet.
      const escapable = SqlSchema.findOneOption({
        Request: Schema.Struct({
          sessionId: Schema.String,
          boundary: Boundary,
          next: Schema.String,
        }),
        Result: Schema.Struct({ project: Schema.String }),
        execute: ({ sessionId, boundary, next }) => sql`
          SELECT e.project FROM autonomy_events e
          JOIN hosted_sessions h ON h.id = e.session_id
          WHERE e.session_id = ${sessionId} AND e.boundary = ${boundary} AND e.kind = 'fern'
            AND h.archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM checkpoints
              WHERE session_id = ${sessionId} AND phase = ${next})
            AND NOT EXISTS (SELECT 1 FROM skips
              WHERE session_id = ${sessionId} AND phase = ${next})
            AND NOT EXISTS (SELECT 1 FROM autonomy_events
              WHERE session_id = ${sessionId} AND boundary = ${boundary} AND kind = 'withdrawn')
          LIMIT 1`,
      });
      const milestoneRow = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: MilestoneRow,
        execute: (id) => sql`
          SELECT id, project, boundary, status, offered_at, decided_at FROM milestones
          WHERE id = ${id}`,
      });

      const record = (
        project: string,
        boundary: Boundary,
        kind: EventKind,
        extra: { readonly sessionId?: string; readonly reason?: string } = {},
      ) =>
        Effect.gen(function* () {
          const at = yield* Clock.currentTimeMillis;
          yield* sql`INSERT INTO autonomy_events ${sql.insert({
            project,
            boundary,
            kind,
            sessionId: extra.sessionId ?? null,
            reason: extra.reason ?? null,
            at,
          })}`;
        });

      // The Session's Project and the boundary the Phase ends, when it's earnable.
      const where = (sessionId: string, phase: Phase) =>
        Effect.gen(function* () {
          if (!isBoundary(phase)) return undefined;
          const project = yield* hosted.projectOf(sessionId);
          return project === undefined
            ? undefined
            : { project, boundary: phase };
        });

      const standing = (project: string, boundary: Boundary) =>
        Effect.gen(function* () {
          const milestones = yield* milestonesOf({ project, boundary });
          const { streak } = yield* streakOf({ project, boundary });
          return {
            streak,
            granted: milestones.some((m) => m.status === "accepted"),
            offer: milestones.find((m) => m.status === "offered"),
          };
        }).pipe(Effect.orDie);

      const covers = Effect.fn("Autonomy.covers")(function* (
        sessionId: string,
        phase: Phase,
      ) {
        const at = yield* where(sessionId, phase);
        if (!at) return false;
        return (yield* standing(at.project, at.boundary)).granted;
      });

      const approved = Effect.fn("Autonomy.approved")(
        function* (sessionId: string, phase: Phase) {
          const at = yield* where(sessionId, phase);
          if (!at) return;
          const before = yield* sessionEvents({
            sessionId,
            boundary: at.boundary,
          });
          const clean = !before.some((e) => e.kind === "declined");
          yield* record(at.project, at.boundary, clean ? "clean" : "approved", {
            sessionId,
          });
          const now = yield* standing(at.project, at.boundary);
          if (now.streak >= AUTONOMY_THRESHOLD && !now.granted && !now.offer)
            yield* sql`INSERT INTO milestones ${sql.insert({
              id: crypto.randomUUID(),
              project: at.project,
              boundary: at.boundary,
              status: "offered",
              offeredAt: yield* Clock.currentTimeMillis,
            })}`;
          yield* bump;
        },
        sql.withTransaction,
        Effect.orDie,
      );

      const declined = Effect.fn("Autonomy.declined")(function* (
        sessionId: string,
        phase: Phase,
      ) {
        const at = yield* where(sessionId, phase);
        if (!at) return;
        yield* record(at.project, at.boundary, "declined", { sessionId });
        yield* bump;
      }, Effect.orDie);

      const approvedByFern = Effect.fn("Autonomy.approvedByFern")(function* (
        sessionId: string,
        phase: Phase,
      ) {
        const at = yield* where(sessionId, phase);
        if (!at) return;
        yield* record(at.project, at.boundary, "fern", { sessionId });
        yield* bump;
      }, Effect.orDie);

      const withdrawAt = (
        project: string,
        boundary: Boundary,
        reason: string,
        sessionId?: string,
      ) =>
        Effect.gen(function* () {
          const decidedAt = yield* Clock.currentTimeMillis;
          yield* sql`UPDATE milestones
            SET status = 'withdrawn', withdrawn_reason = ${reason}, decided_at = ${decidedAt}
            WHERE project = ${project} AND boundary = ${boundary}
              AND status IN ('offered', 'accepted')`;
          yield* record(project, boundary, "withdrawn", { reason, sessionId });
        });

      const withdraw = Effect.fn("Autonomy.withdraw")(
        function* (project: string, boundary: Phase, reason: string) {
          if (!isBoundary(boundary)) return;
          yield* withdrawAt(project, boundary, reason);
          yield* bump;
        },
        sql.withTransaction,
        Effect.orDie,
      );

      const redirected = Effect.fn("Autonomy.redirected")(
        function* (sessionId: string, redirect: Redirect) {
          let escaped = false;
          for (const boundary of BOUNDARIES) {
            const next = PHASES[PHASES.indexOf(boundary) + 1] ?? "";
            const open = yield* escapable({ sessionId, boundary, next });
            if (Option.isNone(open)) continue;
            yield* withdrawAt(
              open.value.project,
              boundary,
              ESCAPE_REASONS[redirect],
              sessionId,
            );
            escaped = true;
          }
          if (escaped) yield* bump;
        },
        sql.withTransaction,
        Effect.orDie,
      );

      // The offered Milestone with the id.
      const open = (id: string) =>
        Effect.gen(function* () {
          const row = yield* milestoneRow(id).pipe(Effect.orDie);
          if (Option.isNone(row)) return yield* new MilestoneNotFound({ id });
          if (row.value.status !== "offered")
            return yield* new MilestoneClosed({ id });
          return row.value;
        });

      const decide = (id: string, status: "accepted" | "declined") =>
        Effect.gen(function* () {
          const milestone = yield* open(id);
          const decidedAt = yield* Clock.currentTimeMillis;
          yield* sql
            .withTransaction(
              Effect.all([
                sql`UPDATE milestones SET status = ${status}, decided_at = ${decidedAt}
                    WHERE id = ${id}`,
                record(milestone.project, milestone.boundary, "reset", {
                  reason: `Milestone ${status}`,
                }),
              ]),
            )
            .pipe(Effect.orDie);
          yield* bump;
        });

      const load = (sessionId: string) =>
        Effect.gen(function* () {
          const project = yield* hosted.projectOf(sessionId);
          if (project === undefined) return null;
          const boundaries = yield* Effect.forEach(BOUNDARIES, (boundary) =>
            Effect.gen(function* () {
              const { streak, granted, offer } = yield* standing(
                project,
                boundary,
              );
              const events = yield* sessionEvents({ sessionId, boundary }).pipe(
                Effect.orDie,
              );
              const withdrawal = yield* withdrawalOf({
                project,
                boundary,
              }).pipe(Effect.orDie);
              return {
                boundary,
                streak,
                threshold: AUTONOMY_THRESHOLD,
                granted,
                offer: offer && toMilestone(offer),
                approvedByFern: events.some((e) => e.kind === "fern"),
                withdrawn: Option.match(withdrawal, {
                  onNone: () => undefined,
                  onSome: ({ reason, at }) => ({
                    reason,
                    at: Schema.decodeSync(Schema.DateTimeUtcFromMillis)(at),
                  }),
                }),
              };
            }),
          );
          return SessionAutonomy.make({ sessionId, project, boundaries });
        });

      return Autonomy.of({
        covers,
        approved,
        declined,
        approvedByFern,
        withdraw,
        redirected,
        autonomy: (sessionId) =>
          SubscriptionRef.changes(version).pipe(
            Stream.mapEffect(() => load(sessionId)),
            Stream.changesWith(
              (a, b) => JSON.stringify(a) === JSON.stringify(b),
            ),
          ),
        accept: Effect.fn("Autonomy.accept")(function* (id: string) {
          return yield* decide(id, "accepted");
        }),
        decline: Effect.fn("Autonomy.decline")(function* (id: string) {
          return yield* decide(id, "declined");
        }),
      });
    }),
  );
}
