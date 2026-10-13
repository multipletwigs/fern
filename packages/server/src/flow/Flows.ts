import { tool } from "@anthropic-ai/claude-agent-sdk";
import {
  Checkpoint,
  CheckpointActionUnavailable,
  CheckpointClosed,
  CheckpointKind,
  type CheckpointWalkthrough,
  CheckpointNotFound,
  type CheckpointStatus,
  Finding,
  Flow,
  FindingNotFound,
  FindingsUndecided,
  type FindingVerdict,
  FindingVerdictKind,
  FlowPhase,
  type Land,
  LandNotReady,
  Phase,
  PHASES,
  PhaseNotSkippable,
  SpecIssues,
  SessionArchived,
  type SessionInUse,
  SessionNotFound,
  type SessionPhase,
  StoredCheckpointStatus,
  type TranscriptError,
  type Walkthrough,
  type WalkthroughError,
} from "@repo/api";
import {
  Clock,
  Context,
  Duration,
  Effect,
  FiberMap,
  Layer,
  Option,
  Schedule,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import { z } from "zod";
import {
  IssueTracker,
  IssueTrackerError,
  IssueTrackerTimeout,
  type TrackedIssue,
} from "../issue/IssueTracker";
import { Autonomy } from "../autonomy/Autonomy";
import { Snapshots } from "../snapshot/Snapshots";
import { commitArg, Stacks } from "../stack/Stacks";
import { refusalMessage, shownPr, waitsOf } from "./land";
import { FernTools } from "../turn/FernTools";
import { HostedSessions } from "../turn/HostedSessions";
import { Turns } from "../turn/Turns";
import { Walkthroughs } from "../walkthrough/Walkthroughs";

export { IssueTrackerTimeout };

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

export const STEERING = `Report the end of each Phase through Fern's \`phase_done\` tool, with the Phase and a short summary of what it settled or produced, then end your turn. Fern raises a Checkpoint, and the developer approves it or declines it with a note. Never start the next Phase's skill yourself (/to-spec, /to-tickets, /implement-spec, /retro): once the developer approves, Fern sends the next Phase's command as your next message. A message that isn't the next Phase's command means the Phase isn't done yet, so keep working on it. Spec is done only once both the Brief and its tickets exist on the issue tracker: report it with the Brief's issue number and its tickets' issue numbers.`;

// When Implement is done where the work doesn't land as a Stack, which has its own rule.
const CLOSED_STEERING = `Implement is done only once every one of those tickets is closed.`;

// What Fern answers while it writes the Walkthrough the Implement Checkpoint waits on.
const HOLDING: Answer = {
  text: "Fern is writing the Session's Walkthrough first; the developer's Checkpoint for the end of Implement appears once it's written. End your turn now; the decision arrives as your next message.",
  isError: false,
};

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

const SpecColumn = Schema.fromJsonString(SpecIssues);
const encodeSpec = Schema.encodeSync(SpecColumn);

// A Checkpoint at the end of Implement is held, and not yet shown, until the Session's
// Walkthrough is written.
const CheckpointRow = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  kind: CheckpointKind,
  phase: Phase,
  summary: Schema.String,
  spec: Schema.NullOr(SpecColumn),
  status: StoredCheckpointStatus,
  note: Schema.NullOr(Schema.String),
  raisedAt: Schema.Finite,
  decidedAt: Schema.NullOr(Schema.Finite),
  walkthroughId: Schema.NullOr(Schema.String),
  walkthroughNumber: Schema.NullOr(Schema.Int),
  // On a Land Checkpoint, GitHub's reason for refusing its last merge, and when it went to the agent.
  refusal: Schema.NullOr(Schema.String),
  refusalSentAt: Schema.NullOr(Schema.Finite),
});
type CheckpointRow = typeof CheckpointRow.Type;

const FindingRow = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  change: Schema.String,
  reasoning: Schema.String,
  verdict: Schema.NullOr(FindingVerdictKind),
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
  land?: Land,
) =>
  Checkpoint.make({
    id: row.id,
    sessionId: row.sessionId,
    kind: row.kind,
    phase: row.phase,
    land,
    summary: row.summary,
    spec: row.spec ?? undefined,
    walkthrough:
      row.walkthroughId !== null && row.walkthroughNumber !== null
        ? { id: row.walkthroughId, number: row.walkthroughNumber }
        : undefined,
    // Held Checkpoints are never shown.
    status: row.status === "held" ? "pending" : row.status,
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

// The Flow after the developer skips the Phase: the next one, if any, is current.
const skipped = (
  phases: ReadonlyArray<FlowPhase>,
  phase: Phase,
  reason: string,
) => {
  const next = PHASES[PHASES.indexOf(phase) + 1];
  return phases.map((p): FlowPhase =>
    p.phase === phase
      ? { phase, status: "skipped", reason }
      : p.phase === next
        ? { phase: p.phase, status: "current" }
        : p,
  );
};

// The commands that start the Phase after this one, if there is one. After a Spec that named its
// Brief, Implement starts on that Brief.
const commandsAfter = (
  phase: Phase,
  spec?: SpecIssues,
): ReadonlyArray<string> => {
  const next = PHASES[PHASES.indexOf(phase) + 1];
  if (next === "implement" && spec)
    return [`/implement-spec #${spec.brief.number}`];
  return next && next !== "grill" ? COMMANDS[next] : [];
};
// The issue numbers the agent gives when it reports Spec done.
interface SpecReport {
  readonly brief: number;
  readonly tickets: ReadonlyArray<number>;
}

// An issue as a Checkpoint shows it.
const shown = ({ number, title, url }: TrackedIssue) => ({
  number,
  title,
  url,
});

// What the Implement Checkpoint links to: the latest written Walkthrough, if there is one.
const linkOf = (
  all: ReadonlyArray<Walkthrough>,
): CheckpointWalkthrough | undefined => {
  const linked = all.findLast((w) => w.status === "ready");
  return linked && { id: linked.id, number: linked.number };
};

// What Fern sends the Session once Retro's Findings all have a verdict: the accepted ones to commit,
// and, where the work lands as a Stack, to report.
const acceptedMessage = (accepted: ReadonlyArray<FindingRow>, stack: boolean) =>
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
    ...(stack
      ? [
          "Then report that commit with Fern's `findings_landed` tool: Fern puts it up as the top PR of the Stack, with its own Walkthrough.",
        ]
      : []),
  ].join("\n\n");

const FINDINGS_LANDED = `Report the commit with the Setup changes from the Findings the developer accepted in the Retro, once Fern has sent them. Fern pushes a branch at the commit and opens its draft PR on top of the Session's Stack, then writes its Walkthrough in the background.`;

// Whether Retro is behind the Session: done, or skipped.
const pastRetro = (phases: ReadonlyArray<FlowPhase>) => {
  const retro = phases.find((p) => p.phase === "retro")?.status;
  return retro === "done" || retro === "skipped";
};

// What a Land Checkpoint says about the Stack it lands.
const landSummary = (prs: number) =>
  `Landing the Stack marks ${prs === 1 ? "its PR" : `its ${prs} PRs`} ready and squash-merges ${prs === 1 ? "it" : "them"} into main, all at once.`;

// What a Fern tool answers the agent.
interface Answer {
  readonly text: string;
  readonly isError: boolean;
}
const reply = ({ text, isError }: Answer) => ({
  content: [{ type: "text" as const, text }],
  ...(isError ? { isError } : {}),
});

// What to tell the agent when Fern couldn't write the Walkthrough Implement's end waits on.
const unwritten = (why: string): Answer => ({
  text: `Fern couldn't write the Session's Walkthrough (${why}), so the developer has no Checkpoint for the end of Implement yet. Report Implement done again.`,
  isError: true,
});
const whyUnwritten = (error: SessionNotFound | WalkthroughError) =>
  error._tag === "SessionNotFound"
    ? "it can't find the Session"
    : error.message;

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
    // Whether the Session's Flow is over: Retro done or skipped, and no Checkpoint pending or held.
    isOver(sessionId: string): Effect.Effect<boolean>;
    // Marks the Checkpoint's Phase done and starts the next one by sending its command. On a Land
    // Checkpoint, starts marking the PRs ready and merging the Stack; again after GitHub refused.
    approve(
      id: string,
    ): Effect.Effect<
      void,
      | CheckpointNotFound
      | CheckpointClosed
      | FindingsUndecided
      | LandNotReady
      | SessionNotFound
      | SessionArchived
      | SessionInUse
      | TranscriptError
    >;
    // Sends the note to the Session as a Redirect; the Phase stays current. Never on Land.
    decline(
      id: string,
      note: string,
    ): Effect.Effect<
      void,
      | CheckpointNotFound
      | CheckpointClosed
      | CheckpointActionUnavailable
      | SessionNotFound
      | SessionArchived
      | SessionInUse
      | TranscriptError
    >;
    // Sends GitHub's reason for refusing the Land Checkpoint's merge to the Session, for the agent
    // to fix. The Checkpoint stays open.
    send(
      id: string,
    ): Effect.Effect<
      void,
      | CheckpointNotFound
      | CheckpointClosed
      | CheckpointActionUnavailable
      | SessionNotFound
      | SessionArchived
      | SessionInUse
      | TranscriptError
    >;
    // Skips the Session's current Phase with the developer's reason, and starts the next one by
    // sending its command. Skipped Phases count neither toward nor against Autonomy.
    skip(
      sessionId: string,
      phase: Phase,
      reason: string,
    ): Effect.Effect<
      void,
      | PhaseNotSkippable
      | SessionNotFound
      | SessionArchived
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
      | SessionArchived
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
      const walkthroughs = yield* Walkthroughs;
      const snapshots = yield* Snapshots;
      const tools = yield* FernTools;
      const issues = yield* IssueTracker;
      const autonomy = yield* Autonomy;
      const stacks = yield* Stacks;
      const patience = Duration.fromInputUnsafe(yield* IssueTrackerTimeout);
      // An issue on the tracker, unless it keeps Fern waiting too long.
      const lookUp = (cwd: string, number: number) =>
        issues.issue(cwd, number).pipe(
          Effect.timeoutOrElse({
            duration: patience,
            orElse: () =>
              Effect.fail(
                new IssueTrackerError({
                  message: `it didn't answer within ${Duration.format(patience)}`,
                }),
              ),
          }),
        );
      // Bumped after every write, so open streams reload.
      const version = yield* SubscriptionRef.make(0);
      const bump = SubscriptionRef.update(version, (n) => n + 1);
      // One decision or report at a time, so a Checkpoint is raised and decided exactly once.
      const deciding = yield* Semaphore.make(1);
      // Held Checkpoints waiting on their Session's Walkthrough, by id.
      const holds = yield* FiberMap.make<string>();
      // A Session started or archived changes the Flows and the queue too.
      yield* hosted.changes.pipe(
        Stream.runForEach(() => bump),
        Effect.forkScoped,
      );

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
      // A Checkpoint's columns, with the number of the Walkthrough it links to.
      const checkpointColumns = sql.literal(
        "checkpoints.*, walkthroughs.number AS walkthrough_number",
      );
      const pendingOf = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: CheckpointRow,
        // An archived Session waits on nothing.
        execute: (sessionId) => sql`
          SELECT ${checkpointColumns} FROM checkpoints
          JOIN hosted_sessions ON hosted_sessions.id = checkpoints.session_id
          LEFT JOIN walkthroughs ON walkthroughs.id = checkpoints.walkthrough_id
          WHERE checkpoints.session_id = ${sessionId} AND checkpoints.status = 'pending'
            AND hosted_sessions.archived_at IS NULL
          ORDER BY checkpoints.raised_at DESC LIMIT 1`,
      });
      const pending = SqlSchema.findAll({
        Request: Schema.Void,
        Result: CheckpointRow,
        // An archived Session waits on nothing, so its Checkpoints leave the queue.
        execute: () => sql`
          SELECT ${checkpointColumns} FROM checkpoints
          JOIN hosted_sessions ON hosted_sessions.id = checkpoints.session_id
          LEFT JOIN walkthroughs ON walkthroughs.id = checkpoints.walkthrough_id
          WHERE checkpoints.status = 'pending' AND hosted_sessions.archived_at IS NULL
          ORDER BY checkpoints.raised_at, checkpoints.rowid`,
      });
      const checkpointRow = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: CheckpointRow,
        execute: (id) => sql`
          SELECT ${checkpointColumns} FROM checkpoints
          LEFT JOIN walkthroughs ON walkthroughs.id = checkpoints.walkthrough_id
          WHERE checkpoints.id = ${id}`,
      });
      // Every held Checkpoint, waiting on its Session's Walkthrough.
      const held = SqlSchema.findAll({
        Request: Schema.Void,
        Result: CheckpointRow,
        execute: () => sql`
          SELECT ${checkpointColumns} FROM checkpoints
          LEFT JOIN walkthroughs ON walkthroughs.id = checkpoints.walkthrough_id
          WHERE checkpoints.status = 'held'`,
      });
      const heldOf = SqlSchema.findOneOption({
        Request: Schema.Struct({ sessionId: Schema.String, phase: Phase }),
        Result: Schema.Struct({ id: Schema.String }),
        execute: ({ sessionId, phase }) => sql`
          SELECT id FROM checkpoints
          WHERE session_id = ${sessionId} AND phase = ${phase} AND status = 'held'`,
      });
      const waitingOf = SqlSchema.findAll({
        Request: Schema.String,
        Result: Schema.Struct({ id: Schema.String }),
        execute: (sessionId) => sql`
          SELECT id FROM checkpoints
          WHERE session_id = ${sessionId} AND status IN ('pending', 'held') LIMIT 1`,
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

      // Hosted Sessions follow the Flow (ADR 0005).
      const inFlow = (sessionId: string) =>
        hosted.session(sessionId).pipe(Effect.map((s) => s !== undefined));

      // Fails for an Archived Session, whose Flow can't move on.
      const unarchived = (sessionId: string) =>
        hosted
          .session(sessionId)
          .pipe(
            Effect.flatMap((s) =>
              s?.archivedAt != null
                ? Effect.fail(new SessionArchived({ id: sessionId }))
                : Effect.void,
            ),
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
          const stack = pastRetro(phases)
            ? yield* standing(sessionId)
            : undefined;
          if (Option.isNone(waiting)) {
            // Once the Land Checkpoint opened, the Stack waits on nothing more before it.
            const opened =
              stack !== undefined &&
              Option.isSome(yield* landRowOf(sessionId).pipe(Effect.orDie));
            return Flow.make({
              sessionId,
              phases,
              landWaitsOn:
                stack && !opened && stack.waiting.length > 0
                  ? stack.waiting
                  : undefined,
            });
          }
          const findings = yield* findingsOf(waiting.value.id).pipe(
            Effect.orDie,
          );
          return Flow.make({
            sessionId,
            phases,
            checkpoint: toCheckpoint(
              waiting.value,
              findings,
              waiting.value.kind === "land" && stack
                ? landOf(waiting.value, stack)
                : undefined,
            ),
          });
        });

      // Reloads after every write, Fern's own and each Session recorded or archived.
      const reloading = <A>(read: Effect.Effect<A>) =>
        SubscriptionRef.changes(version).pipe(
          Stream.mapEffect(() => read),
          Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        );

      // The folder the Session works in, whose repository's issue tracker holds its issues.
      const cwdOf = (sessionId: string) =>
        hosted.session(sessionId).pipe(Effect.map((s) => s?.cwd ?? ""));

      // Spec's exit criteria: the Brief and every ticket exist on the issue tracker of the
      // repository the Session works in. Either what the Checkpoint shows, or what to tell the
      // agent instead.
      const specExit = (sessionId: string, report: SpecReport | undefined) =>
        Effect.gen(function* () {
          if (report === undefined)
            return {
              text: "Report Spec done with `spec`: the Brief's issue number and its tickets' issue numbers.",
              isError: true,
            } satisfies Answer;
          const cwd = yield* cwdOf(sessionId);
          const look = (number: number) =>
            lookUp(cwd, number).pipe(Effect.map(Option.getOrUndefined));
          const [brief, tickets] = yield* Effect.all(
            [
              look(report.brief),
              Effect.forEach(report.tickets, look, { concurrency: 4 }),
            ],
            { concurrency: "unbounded" },
          );
          const missing = [
            ...(brief ? [] : [`the Brief #${report.brief}`]),
            ...report.tickets.flatMap((number, i) =>
              tickets[i] ? [] : [`ticket #${number}`],
            ),
          ];
          if (!brief || missing.length > 0)
            return {
              text: `Spec isn't done: the issue tracker has no ${missing.join(", no ")}. Write the missing issues, or correct the numbers, then report Spec done again.`,
              isError: true,
            } satisfies Answer;
          return SpecIssues.make({
            brief: shown(brief),
            tickets: tickets.flatMap((t) => (t ? [shown(t)] : [])),
          });
        }).pipe(
          Effect.catchTag("IssueTrackerError", (error) =>
            Effect.succeed({
              text: `Fern couldn't check the Brief and tickets on the issue tracker (${error.message}). Report Spec done again once it can.`,
              isError: true,
            } satisfies Answer),
          ),
        );

      // The tickets Spec wrote, as its approved Checkpoint shows them.
      const specOf = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Schema.Struct({ spec: SpecColumn }),
        execute: (sessionId) => sql`
          SELECT spec FROM checkpoints
          WHERE session_id = ${sessionId} AND phase = 'spec' AND status = 'approved'
            AND spec IS NOT NULL
          ORDER BY decided_at DESC LIMIT 1`,
      });

      // Implement's exit criteria: every ticket from Spec is closed on the issue tracker. What to
      // tell the agent when one isn't, if any.
      const ticketsExit = (sessionId: string) =>
        Effect.gen(function* () {
          const spec = yield* specOf(sessionId).pipe(Effect.orDie);
          if (Option.isNone(spec)) return undefined;
          const cwd = yield* cwdOf(sessionId);
          const unclosed = yield* Effect.forEach(
            spec.value.spec.tickets,
            (ticket) =>
              lookUp(cwd, ticket.number).pipe(
                Effect.map(
                  Option.match({
                    onNone: () => [
                      `#${ticket.number} ${ticket.title} (no longer on the issue tracker)`,
                    ],
                    onSome: (found) =>
                      found.state === "closed"
                        ? []
                        : [`#${found.number} ${found.title}`],
                  }),
                ),
              ),
            { concurrency: 4 },
          ).pipe(Effect.map((all) => all.flat()));
          if (unclosed.length === 0) return undefined;
          return {
            text: `Implement isn't done: ${unclosed.length === 1 ? "this ticket is" : "these tickets are"} still open on the issue tracker:\n${unclosed.map((t) => `- ${t}`).join("\n")}\nFinish and close ${unclosed.length === 1 ? "it" : "them"}, then report Implement done again.`,
            isError: true,
          } satisfies Answer;
        }).pipe(
          Effect.catchTag("IssueTrackerError", (error) =>
            Effect.succeed({
              text: `Fern couldn't check the tickets on the issue tracker (${error.message}). Report Implement done again once it can.`,
              isError: true,
            } satisfies Answer),
          ),
        );

      // Implement's exit criteria where the work lands as a Stack: every ticket from Spec has its PR
      // on the Stack, whether or not it's closed yet, as it closes once the Stack lands. What to
      // tell the agent when one hasn't, if any.
      const prsExit = (sessionId: string) =>
        Effect.gen(function* () {
          const spec = yield* specOf(sessionId).pipe(Effect.orDie);
          if (Option.isNone(spec)) return undefined;
          const up = new Set(
            (yield* stacks.prs(sessionId)).flatMap((pr) =>
              pr.ticket === null ? [] : [pr.ticket],
            ),
          );
          const missing = spec.value.spec.tickets.filter(
            (ticket) => !up.has(ticket.number),
          );
          if (missing.length === 0) return undefined;
          return {
            text: `Implement isn't done: ${missing.length === 1 ? "this ticket has" : "these tickets have"} no PR on the Stack yet:\n${missing.map((t) => `- #${t.number} ${t.title}`).join("\n")}\nOnce ${missing.length === 1 ? "it merges" : "each merges"} into this Session's branch, report ${missing.length === 1 ? "it" : "each"} with \`ticket_landed\`, then report Implement done again.`,
            isError: true,
          } satisfies Answer;
        });

      // The Session's Walkthroughs as they are now, oldest first.
      const walkthroughsNow = (sessionId: string) =>
        walkthroughs
          .list(sessionId)
          .pipe(Stream.runHead, Effect.map(Option.getOrElse(() => [])));

      // Land (ADR 0009): once Retro is behind a Session with a Stack, and every Walkthrough in it is
      // Reviewed with no Rejection left open, a Land Checkpoint opens. Approving it marks the PRs
      // ready and merges the Stack; GitHub's refusal keeps it open, with the reason.

      // The Session's Land Checkpoint, pending or approved, if it has one.
      const landRowOf = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: CheckpointRow,
        execute: (sessionId) => sql`
          SELECT ${checkpointColumns} FROM checkpoints
          LEFT JOIN walkthroughs ON walkthroughs.id = checkpoints.walkthrough_id
          WHERE checkpoints.session_id = ${sessionId} AND checkpoints.kind = 'land'
          ORDER BY checkpoints.raised_at DESC LIMIT 1`,
      });

      // The Session's Stack and what it waits on before it can Land; nothing without a Stack.
      const standing = (sessionId: string) =>
        Effect.gen(function* () {
          const prs = yield* stacks.prs(sessionId);
          if (prs.length === 0) return undefined;
          const [all, open, { accepted }] = yield* Effect.all([
            walkthroughsNow(sessionId),
            walkthroughs.openRejections(sessionId),
            acceptedOf(sessionId).pipe(Effect.orDie),
          ]);
          return { prs, waiting: waitsOf(prs, all, open, accepted > 0) };
        });
      type Standing = NonNullable<Effect.Success<ReturnType<typeof standing>>>;

      // Land Checkpoints Fern is merging right now, by id.
      const landing = new Set<string>();
      // Each Session's watch on its Walkthroughs once Retro is behind it, by Session.
      const landWatches = yield* FiberMap.make<string>();
      // Each merge under way, by Land Checkpoint.
      const merges = yield* FiberMap.make<string>();

      const landOf = (row: CheckpointRow, stack: Standing): Land => ({
        prs: stack.prs.map(shownPr),
        url: stack.prs.at(-1)?.url ?? "",
        landing: landing.has(row.id),
        refusal: row.refusal ?? undefined,
        refusalSentAt:
          row.refusalSentAt === null
            ? undefined
            : Schema.decodeSync(Schema.DateTimeUtcFromMillis)(
                row.refusalSentAt,
              ),
        waiting: stack.waiting,
      });

      // Marks the PRs ready and merges the Stack, in the background: the Checkpoint shows it's
      // landing until GitHub answers. Merged, the Checkpoint is approved; refused, it stays open
      // with the reason.
      const startLanding = (id: string, sessionId: string, byFern: boolean) =>
        Effect.gen(function* () {
          landing.add(id);
          yield* bump;
          // GitHub can take a while, so only what it answered is recorded under the lock.
          const settle = stacks.land(sessionId).pipe(
            Effect.matchEffect({
              onSuccess: () =>
                Effect.gen(function* () {
                  const decidedAt = yield* Clock.currentTimeMillis;
                  yield* sql`UPDATE checkpoints
                    SET status = 'approved', decided_at = ${decidedAt}, refusal = NULL
                    WHERE id = ${id}`.pipe(Effect.orDie);
                  yield* byFern
                    ? autonomy.approvedByFern(sessionId, "land")
                    : autonomy.approved(sessionId, "land");
                  yield* FiberMap.remove(landWatches, sessionId);
                }).pipe(deciding.withPermits(1)),
              onFailure: (refused) =>
                sql`UPDATE checkpoints
                  SET refusal = ${refused.reason}, refusal_sent_at = NULL
                  WHERE id = ${id}`.pipe(
                  Effect.orDie,
                  deciding.withPermits(1),
                ),
            }),
            Effect.ensuring(
              Effect.sync(() => landing.delete(id)).pipe(Effect.andThen(bump)),
            ),
          );
          yield* FiberMap.run(merges, id, settle, { onlyIfMissing: true });
        });

      // Opens the Session's Land Checkpoint once its Stack waits on nothing, under Autonomy landing
      // it straight away. Until then, and once it's open, each change to the Session's Walkthroughs
      // may change what the Stack waits on, so the Flow reloads.
      const settleLand = (sessionId: string) =>
        Effect.gen(function* () {
          const session = yield* hosted.session(sessionId);
          if (!session || session.archivedAt !== null) return yield* Effect.void;
          if (!pastRetro(yield* phasesOf(sessionId))) return yield* Effect.void;
          if (Option.isSome(yield* landRowOf(sessionId).pipe(Effect.orDie)))
            return yield* bump;
          const stack = yield* standing(sessionId);
          if (!stack) return yield* Effect.void;
          if (stack.waiting.length > 0) return yield* bump;
          const id = crypto.randomUUID();
          yield* sql`INSERT INTO checkpoints ${sql.insert({
            id,
            sessionId,
            kind: "land",
            phase: "retro",
            summary: landSummary(stack.prs.length),
            status: "pending",
            raisedAt: yield* Clock.currentTimeMillis,
          })}`.pipe(Effect.orDie);
          yield* bump;
          return yield* (yield* autonomy.covers(sessionId, "land"))
            ? startLanding(id, sessionId, true)
            : Effect.void;
        }).pipe(deciding.withPermits(1));

      // Starts watching the Session's Walkthroughs for its Land Checkpoint, once Retro is behind it.
      const watchLand = (sessionId: string) =>
        FiberMap.run(
          landWatches,
          sessionId,
          walkthroughs
            .list(sessionId)
            .pipe(Stream.runForEach(() => settleLand(sessionId))),
          { onlyIfMissing: true },
        ).pipe(Effect.asVoid);

      // Approving the Land Checkpoint, or approving it again after GitHub refused: only while the
      // Stack waits on nothing and Fern isn't merging it already.
      const tryLand = (checkpoint: CheckpointRow) =>
        Effect.gen(function* () {
          if (landing.has(checkpoint.id))
            return yield* new LandNotReady({ id: checkpoint.id });
          const stack = yield* standing(checkpoint.sessionId);
          if (!stack || stack.waiting.length > 0)
            return yield* new LandNotReady({ id: checkpoint.id });
          return yield* startLanding(
            checkpoint.id,
            checkpoint.sessionId,
            false,
          );
        });

      // With nothing changed since it, the Session's latest written Walkthrough covers the working
      // tree, so the Checkpoint links to it; none at all when the Session never changed anything.
      const covering = (sessionId: string) =>
        walkthroughsNow(sessionId).pipe(
          Effect.map((all) => ({ link: linkOf(all) })),
        );

      // The Walkthrough a write just started, once its Fork is done: what the Checkpoint links to,
      // or what to tell the agent if the Fork failed.
      const written = (sessionId: string) =>
        walkthroughs.list(sessionId).pipe(
          Stream.filter((ws) => ws.at(-1)?.status !== "writing"),
          Stream.runHead,
          Effect.map((found) => {
            const latest = Option.getOrUndefined(found)?.at(-1);
            return latest?.status === "ready"
              ? { link: { id: latest.id, number: latest.number } }
              : unwritten(latest?.error ?? "the Fork failed");
          }),
        );

      // Where the work lands as a Stack, each PR has its own Walkthrough, so there's nothing more to
      // write: the Checkpoint links to the top one written, once none is still being written.
      const stackWritten = (sessionId: string) =>
        walkthroughs.list(sessionId).pipe(
          Stream.filter((ws) => ws.every((w) => w.status !== "writing")),
          Stream.runHead,
          Effect.map((found) => ({
            link: linkOf(Option.getOrElse(found, () => [])),
          })),
        );

      // Implement's other exit criterion: a written Walkthrough that covers the working tree as it
      // is now. Fern writes one of whatever changed since the last: "writing" while it does. Else
      // what the Checkpoint links to, or what to tell the agent instead.
      const inGit = (cwd: string) =>
        snapshots.repo(cwd).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
      // A Session in place outside git has nothing Fern can review, so there's nothing to link.
      const walkthroughExit = (sessionId: string) =>
        Effect.gen(function* () {
          if (yield* stacks.landsAsStack(sessionId)) {
            const all = yield* walkthroughsNow(sessionId);
            return all.some((w) => w.status === "writing")
              ? ("writing" as const)
              : { link: linkOf(all) };
          }
          const session = yield* hosted.session(sessionId);
          if (session?.worktree === null && !(yield* inGit(session.cwd)))
            return { link: undefined };
          return yield* walkthroughs.write(sessionId).pipe(
            Effect.as("writing" as const),
            Effect.catchTags({
              WalkthroughInProgress: () => Effect.succeed("writing" as const),
              NothingToReview: () => covering(sessionId),
            }),
            Effect.catch((error) =>
              Effect.succeed(unwritten(whyUnwritten(error))),
            ),
          );
        });

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

      // Leaves the Phase as `leave` marks it (done, or skipped), with the decision `decide` records,
      // makes the next one current and sends its commands. The first is sent before anything is
      // recorded, so a send that fails leaves the decision to retry.
      const moveOn = <E, R>(
        sessionId: string,
        phase: Phase,
        spec: SpecIssues | undefined,
        leave: (phases: ReadonlyArray<FlowPhase>) => ReadonlyArray<FlowPhase>,
        decide: (decidedAt: number) => Effect.Effect<unknown, E, R>,
        after: Effect.Effect<void>,
      ) =>
        Effect.gen(function* () {
          const phases = yield* phasesOf(sessionId);
          const [first, ...rest] = commandsAfter(phase, spec);
          if (first) yield* turns.send(sessionId, { text: first });
          const decidedAt = yield* Clock.currentTimeMillis;
          yield* sql
            .withTransaction(
              Effect.all([
                savePhases(sessionId, leave(phases), decidedAt),
                decide(decidedAt),
              ]),
            )
            .pipe(Effect.orDie);
          yield* after;
          yield* bump;
          for (const text of rest) yield* turns.send(sessionId, { text });
        });

      // Raises the Checkpoint for the developer, or under Autonomy approves it on their behalf.
      const raise = (
        checkpoint: {
          readonly id: string;
          readonly sessionId: string;
          readonly phase: Phase;
          readonly summary: string;
          readonly spec: SpecIssues | null;
          readonly findings: ReadonlyArray<ReportedFinding>;
        },
        walkthrough: CheckpointWalkthrough | undefined,
      ) =>
        Effect.gen(function* () {
          const { id, sessionId, phase, summary, spec, findings } = checkpoint;
          const raisedAt = yield* Clock.currentTimeMillis;
          // A held Checkpoint already has its row.
          const record = (status: CheckpointStatus, decidedAt?: number) =>
            sql`INSERT INTO checkpoints ${sql.insert({
              id,
              sessionId,
              phase,
              summary,
              spec: spec === null ? null : encodeSpec(spec),
              status,
              raisedAt,
              decidedAt: decidedAt ?? null,
              walkthroughId: walkthrough?.id ?? null,
            })}
            ON CONFLICT (id) DO UPDATE SET
              status = excluded.status, raised_at = excluded.raised_at,
              decided_at = excluded.decided_at, walkthrough_id = excluded.walkthrough_id`;
          // Under Autonomy, Fern approves the end of the Phase itself: never the end of a Grill, never
          // a Checkpoint carrying Findings, which only the developer decides, and never the end of
          // Implement without a Walkthrough to link to. If the next command can't be sent, the
          // developer gets the Checkpoint after all.
          if (
            phase !== "grill" &&
            findings.length === 0 &&
            (phase !== "implement" || walkthrough !== undefined) &&
            (yield* autonomy.covers(sessionId, phase))
          ) {
            const byFern = yield* moveOn(
              sessionId,
              phase,
              spec ?? undefined,
              (phases) => advance(phases, phase),
              (decidedAt) => record("approved", decidedAt),
              autonomy.approvedByFern(sessionId, phase),
            ).pipe(
              Effect.as(true),
              Effect.orElseSucceed(() => false),
            );
            if (byFern)
              return {
                text: `Fern approved the end of ${TITLES[phase]} on the developer's behalf. End your turn now; the next Phase's command arrives as your next message.`,
                isError: false,
              } satisfies Answer;
          }
          yield* sql
            .withTransaction(
              Effect.all([
                record("pending"),
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
            text: `Fern raised a Checkpoint for the developer to confirm the end of ${TITLES[phase]}. End your turn now; their decision arrives as your next message.`,
            isError: false,
          } satisfies Answer;
        });

      // Raises the held Checkpoint once its Session's Walkthrough is written: once no other write
      // is under way, Fern writes what changed since the last one, if anything did. That also
      // covers a restart, after which the Fork that was writing it is gone. If the Walkthrough
      // can't be written, there's no Checkpoint, and the agent hears why.
      const release = (id: string) =>
        Effect.gen(function* () {
          const row = yield* checkpointRow(id).pipe(Effect.orDie);
          if (Option.isNone(row)) return;
          const { sessionId } = row.value;
          const outcome = (yield* stacks.landsAsStack(sessionId))
            ? yield* stackWritten(sessionId)
            : yield* walkthroughs.write(sessionId).pipe(
                Effect.retry({
                  while: (error) => error._tag === "WalkthroughInProgress",
                  schedule: Schedule.spaced("250 millis"),
                }),
                Effect.andThen(written(sessionId)),
                Effect.catchTags({
                  NothingToReview: () => covering(sessionId),
                  WalkthroughInProgress: Effect.die,
                }),
                Effect.catch((error) =>
                  Effect.succeed(unwritten(whyUnwritten(error))),
                ),
              );
          const told = yield* Effect.gen(function* () {
            const flow = yield* load(sessionId);
            const still = yield* checkpointRow(id).pipe(Effect.orDie);
            if (Option.isNone(still) || still.value.status !== "held")
              return undefined;
            // Skipped or archived meanwhile, there's nothing to raise; without a Walkthrough,
            // nothing to raise yet.
            const moved =
              flow === null ||
              current(flow.phases) !== still.value.phase ||
              flow.checkpoint !== undefined;
            if (moved || "isError" in outcome) {
              yield* sql`DELETE FROM checkpoints WHERE id = ${id}`.pipe(
                Effect.orDie,
              );
              return moved || !("isError" in outcome) ? undefined : outcome;
            }
            yield* raise({ ...still.value, findings: [] }, outcome.link);
            return undefined;
          }).pipe(deciding.withPermits(1));
          if (told)
            yield* turns
              .send(sessionId, { text: told.text })
              .pipe(
                Effect.catch((error) =>
                  Effect.logWarning(
                    "Couldn't tell the agent its Walkthrough wasn't written",
                    error._tag,
                  ),
                ),
              );
        });

      // Why Fern can't take a report that the Phase is done right now, if it can't.
      const refusal = (sessionId: string, phase: Phase) =>
        Effect.gen(function* () {
          const flow = yield* load(sessionId);
          if (flow === null)
            return {
              text: "This Session doesn't follow Fern's Flow.",
              isError: true,
            } satisfies Answer;
          const now = current(flow.phases);
          if (now === undefined)
            return {
              text: "The Flow is already over.",
              isError: true,
            } satisfies Answer;
          if (now !== phase)
            return {
              text: `The current Phase is ${TITLES[now]}, not ${TITLES[phase]}. Report ${TITLES[now]} done when it is.`,
              isError: true,
            } satisfies Answer;
          if (flow.checkpoint)
            return {
              text: `The developer already has a Checkpoint for the end of ${TITLES[now]}. End your turn; their decision arrives as your next message.`,
              isError: false,
            } satisfies Answer;
          if (
            Option.isSome(
              yield* heldOf({ sessionId, phase }).pipe(Effect.orDie),
            )
          )
            return HOLDING;
          return undefined;
        });

      // The agent says its Phase is done: raise a Checkpoint for the developer. The exit criteria
      // are checked first, outside the lock, since the issue tracker and the Walkthrough take a
      // while; the Checkpoint is then raised under it, if the report still stands.
      const phaseDone = (
        sessionId: string,
        report: {
          readonly phase: Phase;
          readonly summary: string;
          readonly spec?: SpecReport | undefined;
          readonly findings?: ReadonlyArray<ReportedFinding> | undefined;
        },
      ) =>
        Effect.gen(function* () {
          const now = report.phase;
          const refused = yield* refusal(sessionId, now);
          if (refused) return refused;
          const findings = report.findings ?? [];
          if (findings.length > 0 && now !== "retro")
            return {
              text: "Only Retro reports Findings. Report the Phase done without them.",
              isError: true,
            } satisfies Answer;
          // Spec's exit criteria come first: a failed check raises nothing, and Autonomy can't pass it.
          const spec =
            now === "spec" ? yield* specExit(sessionId, report.spec) : null;
          if (spec !== null && "isError" in spec) return spec;
          // So do Implement's: no Checkpoint while a ticket is open, nor without a Walkthrough of
          // the work as it is. While Fern writes one, the Checkpoint is held.
          let walkthrough: CheckpointWalkthrough | "writing" | undefined;
          if (now === "implement") {
            const open = (yield* stacks.landsAsStack(sessionId))
              ? yield* prsExit(sessionId)
              : yield* ticketsExit(sessionId);
            if (open) return open;
            const exit = yield* walkthroughExit(sessionId);
            if (exit !== "writing" && "isError" in exit) return exit;
            walkthrough = exit === "writing" ? exit : exit.link;
          }
          const checkpoint = {
            id: crypto.randomUUID(),
            sessionId,
            phase: now,
            summary: report.summary,
            spec,
            findings,
          };
          return yield* Effect.gen(function* () {
            const refusedNow = yield* refusal(sessionId, now);
            if (refusedNow) return refusedNow;
            if (walkthrough !== "writing")
              return yield* raise(checkpoint, walkthrough);
            const raisedAt = yield* Clock.currentTimeMillis;
            yield* sql`INSERT INTO checkpoints ${sql.insert({
              id: checkpoint.id,
              sessionId,
              phase: now,
              summary: report.summary,
              status: "held",
              raisedAt,
            })}`.pipe(Effect.orDie);
            yield* FiberMap.run(holds, checkpoint.id, release(checkpoint.id));
            return HOLDING;
          }).pipe(deciding.withPermits(1));
        });

      // The pending Checkpoint with the id.
      const open = (id: string) =>
        Effect.gen(function* () {
          const row = yield* checkpointRow(id).pipe(Effect.orDie);
          if (Option.isNone(row)) return yield* new CheckpointNotFound({ id });
          yield* unarchived(row.value.sessionId);
          if (row.value.status !== "pending")
            return yield* new CheckpointClosed({ id });
          return row.value;
        });

      const approve = Effect.fn("Flows.approve")(function* (id: string) {
        const checkpoint = yield* open(id);
        if (checkpoint.kind === "land") return yield* tryLand(checkpoint);
        // Findings settle their Checkpoint through a verdict on each, never through approval.
        yield* findingsOf(id).pipe(
          Effect.orDie,
          Effect.flatMap((findings) =>
            findings.length > 0
              ? Effect.fail(new FindingsUndecided({ id }))
              : Effect.void,
          ),
        );
        yield* moveOn(
          checkpoint.sessionId,
          checkpoint.phase,
          checkpoint.spec ?? undefined,
          (phases) => advance(phases, checkpoint.phase),
          (decidedAt) =>
            sql`UPDATE checkpoints SET status = 'approved', decided_at = ${decidedAt}
                WHERE id = ${id}`,
          autonomy.approved(checkpoint.sessionId, checkpoint.phase),
        );
        return yield* checkpoint.phase === "retro"
          ? watchLand(checkpoint.sessionId)
          : Effect.void;
      }, deciding.withPermits(1));

      const decline = Effect.fn("Flows.decline")(function* (
        id: string,
        note: string,
      ) {
        const checkpoint = yield* open(id);
        if (checkpoint.kind === "land")
          return yield* new CheckpointActionUnavailable({ id });
        const title = TITLES[checkpoint.phase];
        yield* turns.send(checkpoint.sessionId, {
          text: `The developer declined the Checkpoint at the end of ${title}, so ${title} isn't done yet:\n\n${note.trim()}`,
        });
        const decidedAt = yield* Clock.currentTimeMillis;
        yield* sql`UPDATE checkpoints
            SET status = 'declined', note = ${note.trim()}, decided_at = ${decidedAt}
            WHERE id = ${id}`.pipe(Effect.orDie);
        yield* autonomy.declined(checkpoint.sessionId, checkpoint.phase);
        return yield* bump;
      }, deciding.withPermits(1));

      const send = Effect.fn("Flows.send")(function* (id: string) {
        const checkpoint = yield* open(id);
        if (checkpoint.kind !== "land" || checkpoint.refusal === null)
          return yield* new CheckpointActionUnavailable({ id });
        yield* turns.send(checkpoint.sessionId, {
          text: refusalMessage(
            checkpoint.refusal,
            yield* stacks.prs(checkpoint.sessionId),
          ),
        });
        const sentAt = yield* Clock.currentTimeMillis;
        yield* sql`UPDATE checkpoints SET refusal_sent_at = ${sentAt}
            WHERE id = ${id}`.pipe(Effect.orDie);
        return yield* bump;
      }, deciding.withPermits(1));

      // The Session's Flow, if the Phase is its current one and isn't waiting at a Checkpoint.
      const skippable = (sessionId: string, phase: Phase) =>
        Effect.gen(function* () {
          const flow = yield* load(sessionId);
          if (flow === null)
            return yield* new SessionNotFound({ id: sessionId });
          yield* unarchived(sessionId);
          if (current(flow.phases) !== phase)
            return yield* new PhaseNotSkippable({
              session: sessionId,
              phase,
              why: "notCurrent",
            });
          if (flow.checkpoint)
            return yield* new PhaseNotSkippable({
              session: sessionId,
              phase,
              why: "checkpointPending",
            });
          return flow;
        });

      const skip = Effect.fn("Flows.skip")(function* (
        sessionId: string,
        phase: Phase,
        reason: string,
      ) {
        yield* skippable(sessionId, phase);
        yield* moveOn(
          sessionId,
          phase,
          undefined,
          (phases) => skipped(phases, phase, reason),
          (skippedAt) =>
            sql`INSERT INTO skips ${sql.insert({
              id: crypto.randomUUID(),
              sessionId,
              phase,
              reason,
              skippedAt,
            })}`,
          Effect.void,
        );
        if (phase === "retro") yield* watchLand(sessionId);
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
              text: acceptedMessage(
                accepted,
                yield* stacks.landsAsStack(checkpoint.sessionId),
              ),
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
          yield* watchLand(checkpoint.sessionId);
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

      // How many Findings the developer accepted in the Session's Retro.
      const acceptedOf = SqlSchema.findOne({
        Request: Schema.String,
        Result: Schema.Struct({ accepted: Schema.Int }),
        execute: (sessionId) => sql`
          SELECT COUNT(*) AS accepted FROM findings
          JOIN checkpoints ON checkpoints.id = findings.checkpoint_id
          WHERE checkpoints.session_id = ${sessionId} AND checkpoints.phase = 'retro'
            AND findings.verdict = 'accepted'`,
      });

      // The agent reports the commit with the accepted Findings: once Retro is over, it goes up as
      // the top PR of the Stack.
      const findingsLanded = (sessionId: string, commit: string) =>
        Effect.gen(function* () {
          const phases = yield* phasesOf(sessionId);
          if (phases.find((p) => p.phase === "retro")?.status !== "done")
            return {
              text: "Retro isn't over yet. Report its Findings with `phase_done`; once the developer accepts any, Fern sends them for you to commit, and then you report that commit.",
              isError: true,
            } satisfies Answer;
          const { accepted } = yield* acceptedOf(sessionId).pipe(Effect.orDie);
          if (accepted === 0)
            return {
              text: "The developer accepted no Findings in this Session's Retro, so there's no Setup change to put up.",
              isError: true,
            } satisfies Answer;
          return yield* stacks.landed(sessionId, { kind: "findings", commit });
        });

      const phases = Effect.gen(function* () {
        const [sessions, rows] = yield* Effect.all([
          hosted.sessions,
          flowRows().pipe(Effect.orDie),
        ]);
        const byId = new Map(rows.map((row) => [row.sessionId, row.phases]));
        return sessions.map(({ id }): SessionPhase => ({
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
              spec: z
                .object({
                  brief: z
                    .number()
                    .int()
                    .positive()
                    .describe("The Brief's issue number"),
                  tickets: z
                    .array(z.number().int().positive())
                    .min(1)
                    .describe("The issue numbers of the Brief's tickets"),
                })
                .optional()
                .describe(
                  "Required when the Phase is spec: the issues Spec wrote",
                ),
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
      yield* tools.register({
        when: (sessionId) => stacks.landsAsStack(sessionId),
        tools: (sessionId) => [
          tool(
            "findings_landed",
            FINDINGS_LANDED,
            { commit: commitArg("the commit with the accepted Findings") },
            ({ commit }) =>
              run(findingsLanded(sessionId, commit).pipe(Effect.map(reply))),
          ),
        ],
      });
      yield* tools.register({
        steering: CLOSED_STEERING,
        when: (sessionId) =>
          stacks.landsAsStack(sessionId).pipe(Effect.map((stack) => !stack)),
        tools: () => [],
      });

      // Held Checkpoints carry on after a restart.
      yield* held().pipe(
        Effect.orDie,
        Effect.flatMap((rows) =>
          Effect.forEach(rows, (row) =>
            FiberMap.run(holds, row.id, release(row.id)),
          ),
        ),
      );
      // So do the watches for Land, on every Session past Retro whose Stack hasn't landed.
      yield* flowRows().pipe(
        Effect.orDie,
        Effect.flatMap((rows) =>
          Effect.forEach(
            rows.filter((row) => pastRetro(row.phases)),
            ({ sessionId }) =>
              Effect.gen(function* () {
                const session = yield* hosted.session(sessionId);
                if (!session || session.archivedAt !== null) return;
                if ((yield* stacks.prs(sessionId)).length === 0) return;
                const row = yield* landRowOf(sessionId).pipe(Effect.orDie);
                if (Option.isSome(row) && row.value.status === "approved")
                  return;
                yield* watchLand(sessionId);
              }),
            { discard: true },
          ),
        ),
      );

      // A Land Checkpoint in the queue shows the Stack it lands, as in its Session's Flow.
      const queued = (row: CheckpointRow) =>
        row.kind === "land"
          ? standing(row.sessionId).pipe(
              Effect.map((stack) =>
                toCheckpoint(row, [], stack && landOf(row, stack)),
              ),
            )
          : Effect.succeed(toCheckpoint(row));

      return Flows.of({
        flow: (sessionId) => reloading(load(sessionId)),
        checkpoints: reloading(
          pending().pipe(
            Effect.orDie,
            Effect.flatMap((rows) => Effect.forEach(rows, queued)),
          ),
        ),
        phases: reloading(phases),
        isOver: (sessionId) =>
          Effect.all([phasesOf(sessionId), waitingOf(sessionId)]).pipe(
            Effect.orDie,
            Effect.map(
              ([flow, waiting]) =>
                current(flow) === undefined && waiting.length === 0,
            ),
          ),
        approve,
        decline,
        send,
        skip,
        findingVerdict,
      });
    }),
  );
}
