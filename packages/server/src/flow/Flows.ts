import { tool } from "@anthropic-ai/claude-agent-sdk";
import {
  Checkpoint,
  CheckpointClosed,
  CheckpointNotFound,
  CheckpointStatus,
  Finding,
  Flow,
  FindingNotFound,
  FindingsUndecided,
  type FindingVerdict,
  FlowPhase,
  Phase,
  PHASES,
  type SessionInUse,
  type SessionNotFound,
  type SessionPhase,
  type TranscriptError,
} from "@repo/api";
import {
  Clock,
  Context,
  Effect,
  Layer,
  Option,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import { z } from "zod";
import { FernTools } from "../turn/FernTools";
import { HostedSessions } from "../turn/HostedSessions";
import { Turns } from "../turn/Turns";

const TITLES: Record<Phase, string> = {
  grill: "Grill",
  spec: "Spec",
  implement: "Implement",
  retro: "Retro",
};

// What Fern sends into the Session to start each Phase after the first; only the developer can
// start these skills, so Fern sends them on the developer's behalf.
const COMMANDS: Record<Exclude<Phase, "grill">, ReadonlyArray<string>> = {
  spec: ["/to-spec", "/to-tickets"],
  implement: ["/implement-spec"],
  retro: ["/retro"],
};

export const STEERING = `Report the end of each Phase through Fern's \`phase_done\` tool, with the Phase and a short summary of what it settled or produced, then end your turn. Fern raises a Checkpoint, and the developer approves it or declines it with a note. Never start the next Phase's skill yourself (/to-spec, /to-tickets, /implement-spec, /retro): once the developer approves, Fern sends the next Phase's command as your next message. A message that isn't the next Phase's command means the Phase isn't done yet, so keep working on it. Spec is done only once both the Brief and its tickets exist.`;

const PHASE_DONE = `Report the current Phase of Fern's Flow done. Fern raises a Checkpoint for the developer and answers at once; end your turn after calling it. The developer's decision arrives as your next message.`;

// A new Flow: Grill current, the rest not started.
const opening: ReadonlyArray<FlowPhase> = PHASES.map((phase, i) => ({
  phase,
  status: i === 0 ? "current" : "notStarted",
}));

const FlowRow = Schema.Struct({
  sessionId: Schema.String,
  phases: Schema.fromJsonString(Schema.Array(FlowPhase)),
});
const encodePhases = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(FlowPhase)),
);

const CheckpointRow = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  phase: Phase,
  summary: Schema.String,
  status: CheckpointStatus,
  note: Schema.NullOr(Schema.String),
  raisedAt: Schema.Finite,
  decidedAt: Schema.NullOr(Schema.Finite),
});
type CheckpointRow = typeof CheckpointRow.Type;

const FindingRow = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  change: Schema.String,
  reasoning: Schema.String,
  verdict: Schema.NullOr(Schema.Literals(["accepted", "declined"])),
  note: Schema.NullOr(Schema.String),
});
type FindingRow = typeof FindingRow.Type;

const toFinding = (row: FindingRow) =>
  Finding.make({
    id: row.id,
    title: row.title,
    change: row.change,
    reasoning: row.reasoning,
    verdict:
      row.verdict === null
        ? undefined
        : { kind: row.verdict, note: row.note ?? undefined },
  });

// A Finding as the agent reports it.
interface ReportedFinding {
  readonly title: string;
  readonly change: string;
  readonly reasoning: string;
}

const toCheckpoint = (
  row: CheckpointRow,
  findings: ReadonlyArray<FindingRow> = [],
) =>
  Checkpoint.make({
    id: row.id,
    sessionId: row.sessionId,
    phase: row.phase,
    summary: row.summary,
    status: row.status,
    note: row.note ?? undefined,
    findings: findings.length > 0 ? findings.map(toFinding) : undefined,
    raisedAt: Schema.decodeSync(Schema.DateTimeUtcFromMillis)(row.raisedAt),
    decidedAt:
      row.decidedAt === null
        ? undefined
        : Schema.decodeSync(Schema.DateTimeUtcFromMillis)(row.decidedAt),
  });

const current = (phases: ReadonlyArray<FlowPhase>) =>
  phases.find((p) => p.status === "current")?.phase;

// The Flow after the Phase is done: the next one, if any, is current.
const advance = (phases: ReadonlyArray<FlowPhase>, done: Phase) => {
  const next = PHASES[PHASES.indexOf(done) + 1];
  return phases.map((p): FlowPhase =>
    p.phase === done
      ? { phase: p.phase, status: "done" }
      : p.phase === next
        ? { phase: p.phase, status: "current" }
        : p,
  );
};

// What Fern sends the Session once Retro's Findings all have a verdict: the accepted ones to commit.
const acceptedMessage = (accepted: ReadonlyArray<FindingRow>) =>
  [
    `The developer accepted ${accepted.length === 1 ? "this Finding" : "these Findings"} from your Retro. Make ${accepted.length === 1 ? "its change" : "their changes"} to the Setup, then commit on this Session's branch in a commit of its own, separate from the feature code:`,
    ...accepted.map((f, i) =>
      [
        `${i + 1}. ${f.title}`,
        `   Change: ${f.change}`,
        `   Why: ${f.reasoning}`,
        ...(f.note ? [`   Developer's note: ${f.note}`] : []),
      ].join("\n"),
    ),
  ].join("\n\n");

// What a Fern tool answers the agent.
interface Answer {
  readonly text: string;
  readonly isError: boolean;
}
const reply = ({ text, isError }: Answer) => ({
  content: [{ type: "text" as const, text }],
  ...(isError ? { isError } : {}),
});

// Each Hosted Session's Flow (Grill, Spec, Implement, Retro) and the Checkpoints between its
// Phases. The agent reports a Phase done through the `phase_done` tool; Fern raises a Checkpoint,
// and the developer's approval sends the next Phase's command into the Session. Kept in the
// database, so a Flow carries on after Fern restarts.
export class Flows extends Context.Service<
  Flows,
  {
    // The Session's Flow, re-sent whenever it changes; null for a Session outside the Flow.
    flow(sessionId: string): Stream.Stream<Flow | null>;
    // Every pending Checkpoint, oldest first.
    readonly checkpoints: Stream.Stream<ReadonlyArray<Checkpoint>>;
    // Every Hosted Session's current Phase.
    readonly phases: Stream.Stream<ReadonlyArray<SessionPhase>>;
    // Marks the Checkpoint's Phase done and starts the next one by sending its command.
    approve(
      id: string,
    ): Effect.Effect<
      void,
      | CheckpointNotFound
      | CheckpointClosed
      | FindingsUndecided
      | SessionNotFound
      | SessionInUse
      | TranscriptError
    >;
    // Sends the note to the Session as a Redirect; the Phase stays current.
    decline(
      id: string,
      note: string,
    ): Effect.Effect<
      void,
      | CheckpointNotFound
      | CheckpointClosed
      | SessionNotFound
      | SessionInUse
      | TranscriptError
    >;
    // Accepts or declines a Retro Finding. The last verdict marks Retro done and sends the
    // accepted Findings to the Session in one message. Only the developer calls this.
    findingVerdict(
      id: string,
      verdict: FindingVerdict,
    ): Effect.Effect<
      void,
      | FindingNotFound
      | CheckpointClosed
      | SessionNotFound
      | SessionInUse
      | TranscriptError
    >;
  }
>()("@repo/server/flow/Flows") {
  static readonly layer = Layer.effect(
    Flows,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const hosted = yield* HostedSessions;
      const turns = yield* Turns;
      const tools = yield* FernTools;
      // Bumped after every write, so open streams reload.
      const version = yield* SubscriptionRef.make(0);
      const bump = SubscriptionRef.update(version, (n) => n + 1);
      // One decision or report at a time, so a Checkpoint is raised and decided exactly once.
      const deciding = yield* Semaphore.make(1);

      const flowRows = SqlSchema.findAll({
        Request: Schema.Void,
        Result: FlowRow,
        execute: () => sql`SELECT session_id, phases FROM flows`,
      });
      const flowRow = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: FlowRow,
        execute: (sessionId) =>
          sql`SELECT session_id, phases FROM flows WHERE session_id = ${sessionId}`,
      });
      const pendingOf = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: CheckpointRow,
        execute: (sessionId) => sql`
          SELECT * FROM checkpoints
          WHERE session_id = ${sessionId} AND status = 'pending'
          ORDER BY raised_at DESC LIMIT 1`,
      });
      const pending = SqlSchema.findAll({
        Request: Schema.Void,
        Result: CheckpointRow,
        execute: () => sql`
          SELECT * FROM checkpoints WHERE status = 'pending'
          ORDER BY raised_at, rowid`,
      });
      const checkpointRow = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: CheckpointRow,
        execute: (id) => sql`SELECT * FROM checkpoints WHERE id = ${id}`,
      });

      const findingsOf = SqlSchema.findAll({
        Request: Schema.String,
        Result: FindingRow,
        execute: (checkpointId) => sql`
          SELECT id, title, change, reasoning, verdict, note FROM findings
          WHERE checkpoint_id = ${checkpointId} ORDER BY position`,
      });

      const findingRow = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Schema.Struct({ checkpointId: Schema.String }),
        execute: (id) =>
          sql`SELECT checkpoint_id FROM findings WHERE id = ${id}`,
      });

      // Hosted Sessions in a worktree of their own follow the Flow (ADR 0005).
      const inFlow = (sessionId: string) =>
        hosted.worktrees.pipe(
          Effect.map((all) => all.some((w) => w.id === sessionId)),
        );

      // The Session's Phases: Grill current until the first Checkpoint is approved.
      const phasesOf = (sessionId: string) =>
        flowRow(sessionId).pipe(
          Effect.orDie,
          Effect.map(
            Option.match({
              onNone: () => opening,
              onSome: (row) => row.phases,
            }),
          ),
        );

      const load = (sessionId: string) =>
        Effect.gen(function* () {
          if (!(yield* inFlow(sessionId))) return null;
          const phases = yield* phasesOf(sessionId);
          const waiting = yield* pendingOf(sessionId).pipe(Effect.orDie);
          if (Option.isNone(waiting)) return Flow.make({ sessionId, phases });
          const findings = yield* findingsOf(waiting.value.id).pipe(
            Effect.orDie,
          );
          return Flow.make({
            sessionId,
            phases,
            checkpoint: toCheckpoint(waiting.value, findings),
          });
        });

      // Reloads after every write, and every few seconds for Sessions started meanwhile.
      const reloading = <A>(read: Effect.Effect<A>) =>
        Stream.merge(
          SubscriptionRef.changes(version),
          Stream.tick("2 seconds"),
        ).pipe(
          Stream.mapEffect(() => read),
          Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        );

      const savePhases = (
        sessionId: string,
        phases: ReadonlyArray<FlowPhase>,
        at: number,
      ) =>
        sql`INSERT INTO flows ${sql.insert({
          sessionId,
          phases: encodePhases(phases),
          updatedAt: at,
        })}
        ON CONFLICT (session_id) DO UPDATE SET
          phases = excluded.phases, updated_at = excluded.updated_at`;

      // The agent says its Phase is done: raise a Checkpoint for the developer.
      const phaseDone = (
        sessionId: string,
        report: {
          readonly phase: Phase;
          readonly summary: string;
          readonly findings?: ReadonlyArray<ReportedFinding> | undefined;
        },
      ) =>
        Effect.gen(function* () {
          const flow = yield* load(sessionId);
          if (flow === null)
            return {
              text: "This Session doesn't follow Fern's Flow.",
              isError: true,
            };
          const now = current(flow.phases);
          if (now === undefined)
            return { text: "The Flow is already over.", isError: true };
          if (now !== report.phase)
            return {
              text: `The current Phase is ${TITLES[now]}, not ${TITLES[report.phase]}. Report ${TITLES[now]} done when it is.`,
              isError: true,
            };
          if (flow.checkpoint)
            return {
              text: `The developer already has a Checkpoint for the end of ${TITLES[now]}. End your turn; their decision arrives as your next message.`,
              isError: false,
            };
          const findings = report.findings ?? [];
          if (findings.length > 0 && now !== "retro")
            return {
              text: "Only Retro reports Findings. Report the Phase done without them.",
              isError: true,
            };
          const raisedAt = yield* Clock.currentTimeMillis;
          const id = crypto.randomUUID();
          yield* sql
            .withTransaction(
              Effect.all([
                sql`INSERT INTO checkpoints ${sql.insert({
                  id,
                  sessionId,
                  phase: now,
                  summary: report.summary,
                  status: "pending",
                  raisedAt,
                })}`,
                ...findings.map(
                  (finding, position) =>
                    sql`INSERT INTO findings ${sql.insert({
                      id: crypto.randomUUID(),
                      checkpointId: id,
                      position,
                      title: finding.title,
                      change: finding.change,
                      reasoning: finding.reasoning,
                    })}`,
                ),
              ]),
            )
            .pipe(Effect.orDie);
          yield* bump;
          return {
            text: `Fern raised a Checkpoint for the developer to confirm the end of ${TITLES[now]}. End your turn now; their decision arrives as your next message.`,
            isError: false,
          };
        }).pipe(deciding.withPermits(1));

      // The pending Checkpoint with the id.
      const open = (id: string) =>
        Effect.gen(function* () {
          const row = yield* checkpointRow(id).pipe(Effect.orDie);
          if (Option.isNone(row)) return yield* new CheckpointNotFound({ id });
          if (row.value.status !== "pending")
            return yield* new CheckpointClosed({ id });
          return row.value;
        });

      const approve = Effect.fn("Flows.approve")(function* (id: string) {
        const checkpoint = yield* open(id);
        // Findings settle their Checkpoint through a verdict on each, never through approval.
        yield* findingsOf(id).pipe(
          Effect.orDie,
          Effect.flatMap((findings) =>
            findings.length > 0
              ? Effect.fail(new FindingsUndecided({ id }))
              : Effect.void,
          ),
        );
        const phases = yield* phasesOf(checkpoint.sessionId);
        const next = PHASES[PHASES.indexOf(checkpoint.phase) + 1];
        const [first, ...rest] = next && next !== "grill" ? COMMANDS[next] : [];
        // Sent before anything is recorded, so a send that fails leaves the Checkpoint to retry.
        if (first) yield* turns.send(checkpoint.sessionId, { text: first });
        const decidedAt = yield* Clock.currentTimeMillis;
        yield* sql
          .withTransaction(
            Effect.all([
              savePhases(
                checkpoint.sessionId,
                advance(phases, checkpoint.phase),
                decidedAt,
              ),
              sql`UPDATE checkpoints SET status = 'approved', decided_at = ${decidedAt}
                  WHERE id = ${id}`,
            ]),
          )
          .pipe(Effect.orDie);
        yield* bump;
        for (const text of rest)
          yield* turns.send(checkpoint.sessionId, { text });
      }, deciding.withPermits(1));

      const decline = Effect.fn("Flows.decline")(function* (
        id: string,
        note: string,
      ) {
        const checkpoint = yield* open(id);
        const title = TITLES[checkpoint.phase];
        yield* turns.send(checkpoint.sessionId, {
          text: `The developer declined the Checkpoint at the end of ${title}, so ${title} isn't done yet:\n\n${note.trim()}`,
        });
        const decidedAt = yield* Clock.currentTimeMillis;
        yield* sql`UPDATE checkpoints
            SET status = 'declined', note = ${note.trim()}, decided_at = ${decidedAt}
            WHERE id = ${id}`.pipe(Effect.orDie);
        yield* bump;
      }, deciding.withPermits(1));

      // The last Finding has its verdict: Retro is done, and the accepted Findings go back to the
      // Session to commit.
      const finishRetro = (
        checkpoint: CheckpointRow,
        findings: ReadonlyArray<FindingRow>,
        record: Effect.Effect<unknown, SqlError.SqlError>,
        decidedAt: number,
      ) =>
        Effect.gen(function* () {
          const accepted = findings.filter((f) => f.verdict === "accepted");
          // Sent before anything is recorded, so a send that fails leaves the verdict to retry.
          if (accepted.length > 0)
            yield* turns.send(checkpoint.sessionId, {
              text: acceptedMessage(accepted),
            });
          const phases = yield* phasesOf(checkpoint.sessionId);
          yield* sql
            .withTransaction(
              Effect.all([
                record,
                savePhases(
                  checkpoint.sessionId,
                  advance(phases, checkpoint.phase),
                  decidedAt,
                ),
                sql`UPDATE checkpoints SET status = 'approved', decided_at = ${decidedAt}
                    WHERE id = ${checkpoint.id}`,
              ]),
            )
            .pipe(Effect.orDie);
        });

      const findingVerdict = Effect.fn("Flows.findingVerdict")(function* (
        id: string,
        verdict: FindingVerdict,
      ) {
        const finding = yield* findingRow(id).pipe(
          Effect.orDie,
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new FindingNotFound({ id })),
              onSome: Effect.succeed,
            }),
          ),
        );
        // A Finding's Checkpoint always exists.
        const checkpoint = yield* open(finding.checkpointId).pipe(
          Effect.catchTag("CheckpointNotFound", Effect.die),
        );
        const note = verdict.note?.trim() || null;
        const findings = (yield* findingsOf(checkpoint.id).pipe(
          Effect.orDie,
        )).map((f): FindingRow =>
          f.id === id ? { ...f, verdict: verdict.kind, note } : f,
        );
        const decidedAt = yield* Clock.currentTimeMillis;
        const record = sql`UPDATE findings
            SET verdict = ${verdict.kind}, note = ${note}, decided_at = ${decidedAt}
            WHERE id = ${id}`;
        yield* findings.some((f) => f.verdict === null)
          ? record.pipe(Effect.orDie)
          : finishRetro(checkpoint, findings, record, decidedAt);
        yield* bump;
      }, deciding.withPermits(1));

      const phases = Effect.gen(function* () {
        const [worktrees, rows] = yield* Effect.all([
          hosted.worktrees,
          flowRows().pipe(Effect.orDie),
        ]);
        const byId = new Map(rows.map((row) => [row.sessionId, row.phases]));
        return worktrees.map(({ id }): SessionPhase => ({
          sessionId: id,
          current: current(byId.get(id) ?? opening),
        }));
      });

      // The tools answer for the Session they were made for, from a plain async call.
      const run = Effect.runPromiseWith(yield* Effect.context());
      yield* tools.register({
        steering: STEERING,
        tools: (sessionId) => [
          tool(
            "phase_done",
            PHASE_DONE,
            {
              phase: z.enum(PHASES).describe("The Phase that is done"),
              summary: z
                .string()
                .min(1)
                .describe("What the Phase settled or produced, in a few lines"),
              findings: z
                .array(
                  z.object({
                    title: z.string().min(1).describe("The Finding in a line"),
                    change: z
                      .string()
                      .min(1)
                      .describe(
                        "The change it proposes to the Setup: steering files, skills, hooks or Checks",
                      ),
                    reasoning: z
                      .string()
                      .min(1)
                      .describe("Why, from what happened in the Session"),
                  }),
                )
                .optional()
                .describe(
                  "Retro only: the Findings, each a proposed change to the Setup. Don't make the changes yet: the developer accepts or declines each, and Fern sends back the accepted ones to commit.",
                ),
            },
            (args) => run(phaseDone(sessionId, args).pipe(Effect.map(reply))),
          ),
        ],
      });

      return Flows.of({
        flow: (sessionId) => reloading(load(sessionId)),
        checkpoints: reloading(
          pending().pipe(
            Effect.orDie,
            Effect.map((rows) => rows.map((row) => toCheckpoint(row))),
          ),
        ),
        phases: reloading(phases),
        approve,
        decline,
        findingVerdict,
      });
    }),
  );
}
