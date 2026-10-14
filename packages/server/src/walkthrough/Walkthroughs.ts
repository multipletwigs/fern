import { getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import {
  CitedDecision,
  ForeignPr,
  Hunk,
  NothingToReview,
  NotRewritable,
  PrNothingToReview,
  PrWalkthrough,
  PrWalkthroughInProgress,
  PrWalkthroughOf,
  PullRequest,
  ReviewClosed,
  ReviewItemNotFound,
  RiskLevel,
  RoundQuestion,
  Section,
  type SessionBusy,
  type SessionInUse,
  SessionNotFound,
  StackPrKind,
  UnexplainedChange,
  type Verdict,
  type VerdictInput,
  VerdictKind,
  Walkthrough,
  WalkthroughError,
  WalkthroughInProgress,
  WalkthroughNotFound,
  WalkthroughSince,
  WalkthroughStatus,
} from "@repo/api";
import {
  Clock,
  Context,
  DateTime,
  Duration,
  Effect,
  FiberMap,
  Layer,
  Option,
  Predicate,
  Schema,
  type Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import {
  SqlClient,
  SqlSchema,
  type Statement as SqlStatement,
} from "effect/sql";
import { sdk } from "../agentSdk";
import { Autonomy } from "../autonomy/Autonomy";
import { CodeHost } from "../codehost/CodeHost";
import type { GitError } from "../git/Git";
import type { PatchHunk } from "../snapshot/patch";
import { Snapshots, walkthroughRef } from "../snapshot/Snapshots";
import { StackEligibility } from "../stack/StackEligibility";
import { HostedSessions } from "../turn/HostedSessions";
import { Turns } from "../turn/Turns";
import { settle, unclaimedHunks } from "./coverage";
import { prDescription } from "./prDescription";
import {
  type DraftDecision,
  type ForeignPrBrief,
  type Fork,
  type OpenRejection,
  WalkthroughWriter,
} from "./WalkthroughWriter";

// Lines sent per hunk; the rest are counted in `omitted`.
const MAX_HUNK_LINES = 400;
const WRITE_TIMEOUT = Duration.minutes(10);

// Whose change Walkthroughs explain: a Session's, or a Foreign PR's, by its repo on GitHub, as
// "owner/name", and its number.
const Owner = Schema.Union([
  Schema.Struct({ session: Schema.String }),
  Schema.Struct({ repo: Schema.String, number: Schema.Int }),
]);
type Owner = typeof Owner.Type;

// What Walkthroughs being written are counted and queued by: the Session, or the Foreign PR.
const keyOf = (owner: Owner) =>
  "session" in owner ? owner.session : `pr:${owner.repo}#${owner.number}`;

// Exactly one of `sessionId` and the Foreign PR, `prRepo` with `prNumber`, is set.
const WalkthroughRow = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  prRepo: Schema.NullOr(Schema.String),
  prNumber: Schema.NullOr(Schema.Int),
  number: Schema.Int,
  status: WalkthroughStatus,
  error: Schema.NullOr(Schema.String),
  since: WalkthroughSince,
  prId: Schema.NullOr(Schema.String),
  headCommit: Schema.String,
  headTree: Schema.String,
  overlapping: Schema.fromJsonString(Schema.Array(Schema.String)),
  createdAt: Schema.Finite,
  reviewedAt: Schema.NullOr(Schema.Finite),
  redirectSentAt: Schema.NullOr(Schema.Finite),
  redirectError: Schema.NullOr(Schema.String),
});
type WalkthroughRow = typeof WalkthroughRow.Type;

const VerdictColumns = {
  verdict: Schema.NullOr(VerdictKind),
  note: Schema.NullOr(Schema.String),
  decidedAt: Schema.NullOr(Schema.Finite),
};

const SectionRow = Schema.Struct({
  walkthroughId: Schema.String,
  id: Schema.String,
  title: Schema.String,
  explanation: Schema.String,
  dropped: Schema.NullOr(Schema.String),
  fixesWalkthroughId: Schema.NullOr(Schema.String),
  fixesItemId: Schema.NullOr(Schema.String),
  // NULL on a Section written before Sections cited Decisions and carried a Risk.
  decisions: Schema.NullOr(Schema.fromJsonString(Schema.Array(Schema.String))),
  risk: Schema.NullOr(RiskLevel),
  riskReason: Schema.NullOr(Schema.String),
  ...VerdictColumns,
});
type SectionRow = typeof SectionRow.Type;

// A Decision with the Round question that settled it, for what the agent recommended.
const DecisionRow = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  questionId: Schema.String,
  question: Schema.String,
  choice: Schema.NullOr(Schema.String),
  freeText: Schema.NullOr(Schema.String),
  questions: Schema.fromJsonString(Schema.Array(RoundQuestion)),
});
type DecisionRow = typeof DecisionRow.Type;

const toCitedDecision = (row: DecisionRow) =>
  CitedDecision.make({
    id: row.id,
    sessionId: row.sessionId,
    question: row.question,
    recommendation:
      row.questions.find((q) => q.id === row.questionId)?.recommended ?? "",
    choice: row.choice ?? undefined,
    freeText: row.freeText ?? undefined,
  });

// The developer's answer as the Fork reads it: the option they chose, their own words, or both.
const answerOf = (row: DecisionRow) =>
  [row.choice, row.freeText].filter(Predicate.isNotNull).join(". ");

const HunkRow = Schema.Struct({
  walkthroughId: Schema.String,
  id: Schema.String,
  path: Schema.String,
  header: Schema.String,
  lines: Schema.fromJsonString(Schema.Array(Schema.String)),
  added: Schema.Int,
  removed: Schema.Int,
  sectionId: Schema.NullOr(Schema.String),
  notFromSession: Schema.Int,
  ...VerdictColumns,
});
type HunkRow = typeof HunkRow.Type;

const PrRow = Schema.Struct({
  id: Schema.String,
  number: Schema.Int,
  url: Schema.String,
  title: Schema.String,
  position: Schema.Int,
  ticket: Schema.NullOr(Schema.Int),
  kind: StackPrKind,
});
type PrRow = typeof PrRow.Type;

interface SessionRows {
  readonly walkthroughs: ReadonlyArray<WalkthroughRow>;
  readonly sections: ReadonlyArray<SectionRow>;
  readonly hunks: ReadonlyArray<HunkRow>;
  readonly prs: ReadonlyArray<PrRow>;
  // The Decisions the Sections cite.
  readonly decisions: ReadonlyArray<DecisionRow>;
}

const toPullRequest = (row: PrRow) =>
  PullRequest.make({
    number: row.number,
    url: row.url,
    title: row.title,
    position: row.position,
    ticket: row.ticket ?? undefined,
  });

const key = (walkthroughId: string, id: string) => `${walkthroughId}/${id}`;

const verdictOf = (row: {
  verdict: VerdictKind | null;
  note: string | null;
  decidedAt: number | null;
}): Verdict | undefined =>
  row.verdict !== null && row.decidedAt !== null
    ? {
        kind: row.verdict,
        note: row.note ?? undefined,
        at: DateTime.makeUnsafe(row.decidedAt),
      }
    : undefined;

const toHunk = (row: HunkRow) =>
  Hunk.make({
    id: row.id,
    path: row.path,
    header: row.header,
    lines: row.lines.slice(0, MAX_HUNK_LINES),
    omitted: Math.max(0, row.lines.length - MAX_HUNK_LINES),
    added: row.added,
    removed: row.removed,
    notFromSession: row.notFromSession === 1,
  });

const unexplainedTitle = (hunk: HunkRow) =>
  `Unexplained change in ${hunk.path}`;

// What a rejected item is called when another Section says it fixes it.
const itemTitles = ({ sections, hunks }: SessionRows) =>
  new Map([
    ...sections.map((s) => [key(s.walkthroughId, s.id), s.title] as const),
    ...hunks.map(
      (h) => [key(h.walkthroughId, h.id), unexplainedTitle(h)] as const,
    ),
  ]);

const assemble = (rows: SessionRows): ReadonlyArray<Walkthrough> => {
  const titles = itemTitles(rows);
  const numbers = new Map(rows.walkthroughs.map((w) => [w.id, w.number]));
  const prs = new Map(rows.prs.map((pr) => [pr.id, toPullRequest(pr)]));
  const decisions = new Map(
    rows.decisions.map((d) => [d.id, toCitedDecision(d)]),
  );
  return rows.walkthroughs.map((w) => {
    const hunks = rows.hunks.filter((h) => h.walkthroughId === w.id);
    const ready = w.status === "ready";
    return Walkthrough.make({
      id: w.id,
      sessionId: w.sessionId ?? undefined,
      foreignPr:
        w.prRepo !== null && w.prNumber !== null
          ? ForeignPr.make({ repo: w.prRepo, number: w.prNumber })
          : undefined,
      number: w.number,
      status: w.status,
      error: w.error ?? undefined,
      since: w.since,
      pr: w.prId === null ? undefined : prs.get(w.prId),
      createdAt: DateTime.makeUnsafe(w.createdAt),
      overlapping: w.overlapping,
      sections: rows.sections
        .filter((s) => s.walkthroughId === w.id)
        .map((s) => {
          const fixed =
            s.fixesWalkthroughId !== null && s.fixesItemId !== null
              ? key(s.fixesWalkthroughId, s.fixesItemId)
              : undefined;
          return Section.make({
            id: s.id,
            title: s.title,
            explanation: s.explanation,
            dropped: s.dropped ?? undefined,
            fixes:
              fixed !== undefined && s.fixesWalkthroughId !== null
                ? {
                    walkthrough: numbers.get(s.fixesWalkthroughId) ?? 0,
                    title: titles.get(fixed) ?? "",
                  }
                : undefined,
            decisions: (s.decisions ?? []).flatMap(
              (id) => decisions.get(id) ?? [],
            ),
            // Only a Session's agent can change what the developer never agreed to.
            unplanned:
              w.sessionId !== null &&
              s.decisions !== null &&
              s.decisions.length === 0,
            risk:
              s.risk === null
                ? undefined
                : { level: s.risk, reason: s.riskReason ?? "" },
            hunks: hunks.filter((h) => h.sectionId === s.id).map(toHunk),
            verdict: verdictOf(s),
          });
        }),
      // Until the Fork is done, no hunk is unexplained yet.
      unexplained: ready
        ? hunks
            .filter((h) => h.sectionId === null)
            .map((h) =>
              UnexplainedChange.make({
                hunk: toHunk(h),
                verdict: verdictOf(h),
              }),
            )
        : [],
      reviewedAt:
        w.reviewedAt === null ? undefined : DateTime.makeUnsafe(w.reviewedAt),
      redirectSentAt:
        w.redirectSentAt === null
          ? undefined
          : DateTime.makeUnsafe(w.redirectSentAt),
      redirectError: w.redirectError ?? undefined,
    });
  });
};

// Rejected items in the Session's Walkthroughs that no later Section says it fixes.
const openRejections = (rows: SessionRows) => {
  const fixed = new Set(
    rows.sections.flatMap((s) =>
      s.fixesWalkthroughId !== null && s.fixesItemId !== null
        ? [key(s.fixesWalkthroughId, s.fixesItemId)]
        : [],
    ),
  );
  const rejected = [
    ...rows.sections
      .filter((s) => s.verdict === "rejected")
      .map((s) => ({
        walkthroughId: s.walkthroughId,
        itemId: s.id,
        title: s.title,
        note: s.note ?? "",
      })),
    ...rows.hunks
      .filter((h) => h.sectionId === null && h.verdict === "rejected")
      .map((h) => ({
        walkthroughId: h.walkthroughId,
        itemId: h.id,
        title: unexplainedTitle(h),
        note: h.note ?? "",
      })),
  ];
  return rejected
    .filter((r) => !fixed.has(key(r.walkthroughId, r.itemId)))
    .map((r, index) => ({ ...r, id: `r${index + 1}` }));
};

// The message that takes a Walkthrough's Rejections back to the Session: one Redirect per review.
export const redirectMessage = (
  number: number,
  rows: SessionRows,
  walkthroughId: string,
) => {
  const lines = [
    ...rows.sections
      .filter(
        (s) => s.walkthroughId === walkthroughId && s.verdict === "rejected",
      )
      .map((s) => `- "${s.title}": ${s.note ?? ""}`),
    ...rows.hunks
      .filter(
        (h) =>
          h.walkthroughId === walkthroughId &&
          h.sectionId === null &&
          h.verdict === "rejected",
      )
      .map(
        (h) =>
          `- The unexplained change in \`${h.path}\` (${h.header}): ${h.note ?? ""}`,
      ),
  ];
  if (lines.length === 0) return undefined;
  // A Session's one PR takes the fix itself, with its next Walkthrough; a PR of a ticketed Stack
  // never changes once it's up, so the fix goes up as a PR of its own.
  const prId = rows.walkthroughs.find((w) => w.id === walkthroughId)?.prId;
  const kind = rows.prs.find((pr) => pr.id === prId)?.kind;
  const ask =
    kind !== undefined && kind !== "session"
      ? "Please address these: commit the fix on this Session's branch, then report it with Fern's `fix_landed` tool, which puts it up as a new PR on top of the Stack."
      : kind === "session"
        ? "Please address these: commit the fix on this Session's branch, and Fern's next Walkthrough of its PR shows it."
        : "Please address these.";
  return `I reviewed Walkthrough ${number} and rejected part of it:\n\n${lines.join("\n")}\n\n${ask}`;
};

// What the Fork is asked to explain, numbered, the Rejections it may say it fixes, and the
// Project's Decisions it may cite.
const askingOf = (
  patch: ReadonlyArray<PatchHunk>,
  rows: SessionRows,
  decisions: ReadonlyArray<DecisionRow>,
) => {
  const hunks = patch.map((hunk, index) => ({
    ...hunk,
    id: `h${index + 1}`,
  }));
  const rejections = openRejections(rows);
  return {
    hunks,
    rejections,
    asked: {
      hunks,
      rejections: rejections.map((r) => ({
        id: r.id,
        title: r.title,
        note: r.note,
      })),
      decisions: decisions.map((d, index): DraftDecision => ({
        id: `d${index + 1}`,
        decisionId: d.id,
        question: d.question,
        answer: answerOf(d),
      })),
    },
  };
};

const requestOf = (
  sessionId: string,
  cwd: string,
  since: WalkthroughSince,
  patch: ReadonlyArray<PatchHunk>,
  rows: SessionRows,
  decisions: ReadonlyArray<DecisionRow>,
) => {
  const { hunks, rejections, asked } = askingOf(patch, rows, decisions);
  return {
    hunks,
    rejections,
    request: { sessionId, cwd, since, ...asked },
  };
};

const gitFailed = (error: GitError) =>
  new WalkthroughError({ message: error.message });

const failureMessage = (error: { readonly _tag: string }) =>
  Predicate.hasProperty(error, "message") && Predicate.isString(error.message)
    ? error.message
    : error._tag;

const REDIRECT_REFUSED = {
  SessionNotFound: "The Session no longer exists.",
  SessionBusy: "Fern is already running a turn on this Session.",
  SessionInUse:
    "The Session is in use elsewhere, such as Claude Code in a terminal.",
};

const redirectFailure = (
  error: SessionNotFound | SessionBusy | SessionInUse | WalkthroughError,
) =>
  error._tag === "WalkthroughError"
    ? error.message
    : REDIRECT_REFUSED[error._tag];

// The change a Walkthrough of a PR covers: between two commits on the Session's branch.
export interface PrChange {
  readonly id: string;
  readonly cwd: string;
  readonly from: string;
  readonly to: string;
  readonly since?: WalkthroughSince;
}

// The change a Walkthrough of a Foreign PR covers: from `from` to its head, `to`, which the worktree
// `cwd` is checked out at. `from` is where it leaves its base, the merge-base, for the whole PR
// (`pr`), or the previous Walkthrough's head, for what changed since (`previous`). The merge-base is
// kept either way, so a later Walkthrough can tell the base moved.
export interface ForeignChange {
  // The Project the PR is on, whose Decisions its Sections may cite.
  readonly project: string;
  readonly cwd: string;
  readonly pr: ForeignPrBrief;
  readonly since: "pr" | "previous";
  readonly from: string;
  readonly to: string;
  readonly mergeBase: string;
  // What it waits its turn behind besides its own PR's, as a Stack's PRs are written one at a time.
  readonly queue?: string;
}

// A Foreign PR's latest written Walkthrough: the head it explains, and the merge-base it was
// written against.
export interface ForeignWritten {
  readonly head: string;
  readonly mergeBase: string;
}

// What a Walkthrough being written runs: its writer, then what follows once it's stored.
interface Writing {
  readonly id: string;
  // What it's counted by: its Session's, or its Foreign PR's.
  readonly key: string;
  // What it waits its turn by, when not `key`.
  readonly queue?: string;
  readonly fork: Effect.Effect<Fork, WalkthroughError, Scope.Scope>;
  readonly ids: ReadonlyArray<string>;
  readonly decisions: ReadonlyArray<DraftDecision>;
  readonly rejections: ReadonlyArray<
    OpenRejection & { walkthroughId: string; itemId: string }
  >;
  readonly after: Effect.Effect<void>;
  // What to say when the writer takes too long.
  readonly late: string;
}

// Where a Foreign PR's latest Walkthrough stands.
const prStateOf = (row: {
  readonly status: WalkthroughStatus;
  readonly reviewedAt: number | null;
}) =>
  row.status !== "ready"
    ? row.status
    : row.reviewedAt === null
      ? "unreviewed"
      : "reviewed";

// What a Walkthrough Fern was writing when it stopped says, once it's started again.
const STOPPED =
  "Fern stopped before this Walkthrough was written. Walk through the PR again to write it.";

// Writes, stores, and reviews Walkthroughs (ADR 0003, stored per ADR 0004).
export class Walkthroughs extends Context.Service<
  Walkthroughs,
  {
    // A Session's Walkthroughs, oldest first, re-sent whenever one changes.
    list(sessionId: string): Stream.Stream<ReadonlyArray<Walkthrough>>;
    // Snapshots the working tree and starts a Fork writing the Walkthrough of what changed.
    write(
      sessionId: string,
    ): Effect.Effect<
      void,
      | SessionNotFound
      | NothingToReview
      | WalkthroughInProgress
      | WalkthroughError
    >;
    // Starts writing a Walkthrough of one PR of the Session's Stack: the change from the commit
    // `from` to the commit `to`, which is the whole PR's (`pr`, the default), or, on a Session's one
    // PR, what changed since its previous Walkthrough. Fern writes a Session's Walkthroughs one at a
    // time, so it waits its turn behind any being written; until then it shows as being written.
    writePr(
      sessionId: string,
      pr: PrChange,
    ): Effect.Effect<void, NothingToReview | WalkthroughError>;
    verdict(
      walkthroughId: string,
      item: string,
      input: VerdictInput,
    ): Effect.Effect<
      void,
      WalkthroughNotFound | ReviewItemNotFound | ReviewClosed | WalkthroughError
    >;
    // Sends a Reviewed Walkthrough's Rejection notes to the Session again.
    redirect(
      walkthroughId: string,
    ): Effect.Effect<
      void,
      | WalkthroughNotFound
      | ReviewClosed
      | SessionNotFound
      | SessionBusy
      | SessionInUse
      | WalkthroughError
    >;
    // Writes a PR's Walkthrough that couldn't be written again, of the same change.
    rewrite(
      walkthroughId: string,
    ): Effect.Effect<void, WalkthroughNotFound | NotRewritable>;
    // A Foreign PR's Walkthroughs, oldest first, re-sent whenever one changes.
    listForeign(
      repo: string,
      number: number,
    ): Stream.Stream<ReadonlyArray<Walkthrough>>;
    // Starts writing a Walkthrough of a Foreign PR's change (ADR 0010). Its Sections are never
    // Unplanned, and its verdicts go nowhere. One that failed before it is replaced.
    writeForeign(
      change: ForeignChange,
    ): Effect.Effect<
      void,
      PrNothingToReview | PrWalkthroughInProgress | WalkthroughError
    >;
    // The latest Walkthrough of each of the repo's Foreign PRs that has one.
    foreignStates(repo: string): Effect.Effect<ReadonlyArray<PrWalkthroughOf>>;
    // The Foreign PR's latest Walkthrough that was written, when it has one.
    lastWritten(
      repo: string,
      number: number,
    ): Effect.Effect<Option.Option<ForeignWritten>>;
    // The same, re-sent whenever a Walkthrough changes.
    liveForeignStates(
      repo: string,
    ): Stream.Stream<ReadonlyArray<PrWalkthroughOf>>;
    // The Session's Rejections no later Section says it fixes: each with the Walkthrough it's in
    // and what was rejected.
    openRejections(sessionId: string): Effect.Effect<
      ReadonlyArray<{
        readonly walkthroughId: string;
        readonly title: string;
      }>
    >;
  }
>()("@repo/server/walkthrough/Walkthroughs") {
  static readonly layer = Layer.effect(
    Walkthroughs,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const snapshots = yield* Snapshots;
      const turns = yield* Turns;
      const writer = yield* WalkthroughWriter;
      const autonomy = yield* Autonomy;
      const stacks = yield* StackEligibility;
      const hosted = yield* HostedSessions;
      const codeHost = yield* CodeHost;
      // Bumped after every write, so open lists reload.
      const version = yield* SubscriptionRef.make(0);
      const bump = SubscriptionRef.update(version, (n) => n + 1);
      const record = (update: SqlStatement.Statement<unknown>) =>
        update.pipe(Effect.orDie, Effect.andThen(bump));
      // How many Walkthroughs of each Session are being written or waiting to be.
      const writing = new Map<string, number>();
      const started = (sessionId: string) =>
        Effect.sync(() =>
          writing.set(sessionId, (writing.get(sessionId) ?? 0) + 1),
        );
      const done = (sessionId: string) =>
        Effect.sync(() => {
          const left = (writing.get(sessionId) ?? 1) - 1;
          if (left > 0) writing.set(sessionId, left);
          else writing.delete(sessionId);
        });
      // Each Session's Forks write one at a time, so a PR's Walkthrough waits for the one below.
      const queues = new Map<string, Semaphore.Semaphore>();
      const queueOf = (sessionId: string) =>
        Effect.gen(function* () {
          const found = queues.get(sessionId);
          if (found) return found;
          const made = yield* Semaphore.make(1);
          queues.set(sessionId, made);
          return made;
        });
      // Keyed by Walkthrough, so starting one never interrupts another.
      const forks = yield* FiberMap.make<string>();
      // Verdicts one at a time, so the last one sends the Redirect exactly once.
      const reviewing = yield* Semaphore.make(1);

      const ownedBy = (owner: Owner) =>
        "session" in owner
          ? sql`w.session_id = ${owner.session}`
          : sql`w.pr_repo = ${owner.repo} AND w.pr_number = ${owner.number}`;
      const walkthroughsOf = SqlSchema.findAll({
        Request: Owner,
        Result: WalkthroughRow,
        execute: (owner) =>
          sql`SELECT w.* FROM walkthroughs w WHERE ${ownedBy(owner)} ORDER BY w.number`,
      });
      const sectionsOf = SqlSchema.findAll({
        Request: Owner,
        Result: SectionRow,
        execute: (owner) => sql`
          SELECT s.* FROM walkthrough_sections s
          JOIN walkthroughs w ON w.id = s.walkthrough_id
          WHERE ${ownedBy(owner)}
          ORDER BY s.position`,
      });
      const hunksOf = SqlSchema.findAll({
        Request: Owner,
        Result: HunkRow,
        execute: (owner) => sql`
          SELECT h.* FROM walkthrough_hunks h
          JOIN walkthroughs w ON w.id = h.walkthrough_id
          WHERE ${ownedBy(owner)}
          ORDER BY h.position`,
      });
      const sessionPrs = SqlSchema.findAll({
        Request: Schema.String,
        Result: PrRow,
        execute: (sessionId) => sql`
          SELECT id, number, url, title, position, ticket, kind FROM stack_prs
          WHERE session_id = ${sessionId} ORDER BY position`,
      });
      // A Foreign PR is on no Stack of Fern's.
      const prsOf = (owner: Owner) =>
        "session" in owner
          ? sessionPrs(owner.session)
          : Effect.succeed<ReadonlyArray<PrRow>>([]);
      const ownerRow = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Schema.Struct({
          sessionId: Schema.NullOr(Schema.String),
          prRepo: Schema.NullOr(Schema.String),
          prNumber: Schema.NullOr(Schema.Int),
        }),
        execute: (id) =>
          sql`SELECT session_id, pr_repo, pr_number FROM walkthroughs WHERE id = ${id}`,
      });

      const decisionsById = SqlSchema.findAll({
        Request: Schema.Array(Schema.String),
        Result: DecisionRow,
        execute: (ids) => sql`
          SELECT d.id, d.session_id, d.question_id, d.question, d.choice, d.free_text, r.questions
          FROM decisions d JOIN rounds r ON r.id = d.round_id
          WHERE d.id IN ${sql.in(ids)}`,
      });
      // Oldest first, as the developer settled them.
      const decisionsOfProject = SqlSchema.findAll({
        Request: Schema.String,
        Result: DecisionRow,
        execute: (project) => sql`
          SELECT d.id, d.session_id, d.question_id, d.question, d.choice, d.free_text, r.questions
          FROM decisions d JOIN rounds r ON r.id = d.round_id
          WHERE d.project = ${project}
          ORDER BY d.decided_at, r.posted_at, d.rowid`,
      });
      // Decisions belong to the Project, so Sections can cite ones from earlier Sessions. A Session
      // Fern didn't start belongs to its repository's Project.
      const citable = (sessionId: string, repo: string) =>
        hosted
          .projectOf(sessionId)
          .pipe(
            Effect.flatMap((project) =>
              decisionsOfProject(project ?? repo).pipe(Effect.orDie),
            ),
          );

      const load = (owner: Owner) =>
        Effect.gen(function* () {
          const rows = yield* Effect.all({
            walkthroughs: walkthroughsOf(owner),
            sections: sectionsOf(owner),
            hunks: hunksOf(owner),
            prs: prsOf(owner),
          });
          const cited = [
            ...new Set(rows.sections.flatMap((s) => s.decisions ?? [])),
          ];
          const decisions =
            cited.length === 0 ? [] : yield* decisionsById(cited);
          return { ...rows, decisions };
        }).pipe(Effect.orDie);

      const listOf = (owner: Owner) =>
        SubscriptionRef.changes(version).pipe(
          Stream.mapEffect(() => load(owner)),
          Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
          Stream.map(assemble),
        );
      const list = (sessionId: string) => listOf({ session: sessionId });
      const listForeign = (repo: string, number: number) =>
        listOf({ repo, number });

      // Each Foreign PR's latest Walkthrough.
      const latestOfPrs = SqlSchema.findAll({
        Request: Schema.String,
        Result: Schema.Struct({
          prNumber: Schema.Int,
          status: WalkthroughStatus,
          headCommit: Schema.String,
          error: Schema.NullOr(Schema.String),
          reviewedAt: Schema.NullOr(Schema.Finite),
        }),
        execute: (repo) => sql`
          SELECT w.pr_number, w.status, w.head_commit, w.error, w.reviewed_at
          FROM walkthroughs w
          WHERE w.pr_repo = ${repo} AND w.number = (
            SELECT MAX(v.number) FROM walkthroughs v
            WHERE v.pr_repo = w.pr_repo AND v.pr_number = w.pr_number)
          ORDER BY w.pr_number`,
      });
      const foreignStates = (repo: string) =>
        latestOfPrs(repo).pipe(
          Effect.orDie,
          Effect.map((rows) =>
            rows.map((row) =>
              PrWalkthroughOf.make({
                number: row.prNumber,
                walkthrough: PrWalkthrough.make({
                  state: prStateOf(row),
                  head: row.headCommit,
                  error: row.error ?? undefined,
                }),
              }),
            ),
          ),
        );
      const lastWrittenOf = SqlSchema.findOneOption({
        Request: Schema.Struct({ repo: Schema.String, number: Schema.Int }),
        Result: Schema.Struct({
          headCommit: Schema.String,
          mergeBase: Schema.String,
        }),
        execute: ({ repo, number }) => sql`
          SELECT head_commit, merge_base FROM walkthroughs
          WHERE pr_repo = ${repo} AND pr_number = ${number} AND status = 'ready'
            AND merge_base IS NOT NULL
          ORDER BY number DESC LIMIT 1`,
      });
      const lastWritten = (repo: string, number: number) =>
        lastWrittenOf({ repo, number }).pipe(
          Effect.orDie,
          Effect.map(
            Option.map((row): ForeignWritten => ({
              head: row.headCommit,
              mergeBase: row.mergeBase,
            })),
          ),
        );
      const liveForeignStates = (repo: string) =>
        SubscriptionRef.changes(version).pipe(
          Stream.mapEffect(() => foreignStates(repo)),
          Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        );

      const finish = Effect.fn("Walkthroughs.finish")(function* (
        walkthroughId: string,
        hunkIds: ReadonlyArray<string>,
        draft: Parameters<typeof settle>[0],
        rejections: ReadonlyArray<
          OpenRejection & { walkthroughId: string; itemId: string }
        >,
        decisions: ReadonlyArray<DraftDecision>,
      ) {
        const { sections, notFromSession } = settle(draft, hunkIds, decisions);
        const byRejection = new Map(rejections.map((r) => [r.id, r]));
        yield* sql.withTransaction(
          Effect.gen(function* () {
            for (const [index, section] of sections.entries()) {
              const id = `s${index + 1}`;
              const fixes = section.fixes
                ? byRejection.get(section.fixes)
                : undefined;
              yield* sql`INSERT INTO walkthrough_sections ${sql.insert({
                walkthroughId,
                id,
                position: index,
                title: section.title,
                explanation: section.explanation,
                dropped: section.dropped ?? null,
                fixesWalkthroughId: fixes?.walkthroughId ?? null,
                fixesItemId: fixes?.itemId ?? null,
                decisions: JSON.stringify(section.decisions),
                risk: section.risk.level,
                riskReason: section.risk.reason,
              })}`;
              for (const hunk of section.hunks)
                yield* sql`UPDATE walkthrough_hunks SET section_id = ${id}
                  WHERE walkthrough_id = ${walkthroughId} AND id = ${hunk}`;
            }
            for (const hunk of notFromSession)
              yield* sql`UPDATE walkthrough_hunks SET not_from_session = 1
                WHERE walkthrough_id = ${walkthroughId} AND id = ${hunk}`;
            yield* sql`UPDATE walkthroughs SET status = 'ready' WHERE id = ${walkthroughId}`;
          }),
        );
      }, Effect.orDie);

      const fail = (walkthroughId: string, message: string) =>
        sql`UPDATE walkthroughs SET status = 'failed', error = ${message}
          WHERE id = ${walkthroughId}`.pipe(Effect.orDie, Effect.asVoid);

      // Makes a PR's Walkthroughs, once one is written, the PR's description, so GitHub never shows
      // a stale one: every written Walkthrough of the PR, oldest first, as the PR carries every
      // change they cover. A failed Walkthrough leaves the description as it was; so does a code
      // host that can't be reached, until the next Walkthrough of the PR.
      const describe = (
        walkthroughId: string,
        sessionId: string,
        cwd: string,
      ) =>
        Effect.gen(function* () {
          const all = assemble(yield* load({ session: sessionId }));
          const walkthrough = all.find((w) => w.id === walkthroughId);
          if (walkthrough?.status !== "ready" || walkthrough.pr === undefined)
            return;
          const number = walkthrough.pr.number;
          const ofPr = all.filter(
            (w) => w.status === "ready" && w.pr?.number === number,
          );
          yield* codeHost
            .setBody(cwd, number, prDescription(ofPr))
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning(
                  `Couldn't update PR #${walkthrough.pr?.number ?? "?"}'s description`,
                  error.message,
                ),
              ),
            );
        });

      // Runs the writer and stores what it wrote, giving it one retry to claim what it left out.
      const compose = ({
        id,
        key: queued,
        queue: turn = queued,
        fork: writeWith,
        ids,
        decisions,
        rejections,
        after,
        late,
      }: Writing) => {
        const write = Effect.gen(function* () {
          const fork = yield* writeWith;
          let draft = fork.draft;
          const unclaimed = unclaimedHunks(draft, ids);
          if (unclaimed.length > 0)
            draft = yield* fork.revise(unclaimed).pipe(
              // A failed retry still leaves the first draft; what it missed shows as unexplained.
              Effect.orElseSucceed(() => draft),
            );
          yield* finish(id, ids, draft, rejections, decisions);
        }).pipe(
          Effect.scoped,
          Effect.timeoutOrElse({
            duration: WRITE_TIMEOUT,
            orElse: () => Effect.fail(new WalkthroughError({ message: late })),
          }),
          Effect.catch((error) => fail(id, error.message)),
        );
        return queueOf(turn).pipe(
          Effect.flatMap((queue) =>
            queue.withPermits(1)(write.pipe(Effect.andThen(after))),
          ),
          Effect.ensuring(done(queued).pipe(Effect.andThen(bump))),
        );
      };

      // A Session's Walkthrough is written by its Fork, and becomes its PR's description.
      const forkWriting = (prepared: {
        readonly id: string;
        readonly request: Parameters<typeof writer.write>[0];
        readonly rejections: ReturnType<typeof openRejections>;
      }): Writing => ({
        id: prepared.id,
        key: prepared.request.sessionId,
        fork: writer.write(prepared.request),
        ids: prepared.request.hunks.map((hunk) => hunk.id),
        decisions: prepared.request.decisions,
        rejections: prepared.rejections,
        after: describe(
          prepared.id,
          prepared.request.sessionId,
          prepared.request.cwd,
        ),
        late: "The Fork took too long.",
      });

      // Stores the Walkthrough's row and its hunks, being written, numbered after its Session's or
      // its Foreign PR's latest. A Foreign PR's that failed is replaced: nothing in it was
      // reviewed, and walking through the PR again is how it's written.
      const insert = (
        owner: Owner,
        walkthrough: {
          readonly id: string;
          readonly repo: string;
          readonly since: WalkthroughSince;
          readonly prId: string | null;
          readonly baseTree: string;
          readonly headCommit: string;
          readonly headTree: string;
          readonly overlapping: ReadonlyArray<string>;
          readonly mergeBase: string | null;
        },
        hunks: ReadonlyArray<PatchHunk & { readonly id: string }>,
      ) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          yield* sql
            .withTransaction(
              Effect.gen(function* () {
                if (!("session" in owner)) {
                  const failed = sql`SELECT w.id FROM walkthroughs w
                    WHERE ${ownedBy(owner)} AND w.status = 'failed'`;
                  yield* sql`DELETE FROM walkthrough_hunks WHERE walkthrough_id IN (${failed})`;
                  yield* sql`DELETE FROM walkthroughs WHERE id IN (${failed})`;
                }
                const [last] = yield* sql<{ number: number }>`
                  SELECT MAX(w.number) AS number FROM walkthroughs w
                  WHERE ${ownedBy(owner)}`;
                yield* sql`INSERT INTO walkthroughs ${sql.insert({
                  ...walkthrough,
                  ...("session" in owner
                    ? { sessionId: owner.session }
                    : { prRepo: owner.repo, prNumber: owner.number }),
                  number: (last?.number ?? 0) + 1,
                  status: "writing",
                  overlapping: JSON.stringify(walkthrough.overlapping),
                  createdAt: now,
                })}`;
                for (const [position, hunk] of hunks.entries())
                  yield* sql`INSERT INTO walkthrough_hunks ${sql.insert({
                    walkthroughId: walkthrough.id,
                    id: hunk.id,
                    position,
                    path: hunk.path,
                    header: hunk.header,
                    lines: JSON.stringify(hunk.lines),
                    added: hunk.added,
                    removed: hunk.removed,
                  })}`;
              }),
            )
            .pipe(Effect.orDie);
        });

      const prepare = Effect.fn("Walkthroughs.prepare")(function* (
        sessionId: string,
      ) {
        const info = yield* sdk("getSessionInfo", () =>
          getSessionInfo(sessionId),
        ).pipe(
          Effect.mapError((e) => new WalkthroughError({ message: e.message })),
          Effect.filterOrFail(
            Predicate.isNotUndefined,
            () => new SessionNotFound({ id: sessionId }),
          ),
        );
        if (info.cwd === undefined)
          return yield* new WalkthroughError({
            message: "The Session has no folder to compare.",
          });
        const cwd = info.cwd;
        const repo = yield* snapshots
          .repo(cwd)
          .pipe(Effect.mapError(gitFailed));
        const rows = yield* load({ session: sessionId });
        const previous = rows.walkthroughs.findLast(
          (w) => w.status === "ready",
        );
        const start = previous
          ? Option.none()
          : yield* snapshots
              .start(repo, sessionId)
              .pipe(Effect.mapError(gitFailed));
        const base: {
          since: WalkthroughSince;
          tree: string;
          at: number | undefined;
        } = previous
          ? {
              since: "previous",
              tree: previous.headTree,
              at: previous.createdAt,
            }
          : Option.isSome(start)
            ? {
                since: "start",
                tree: start.value.tree,
                at: start.value.takenAt,
              }
            : {
                since: "head",
                tree: yield* snapshots
                  .head(repo)
                  .pipe(Effect.mapError(gitFailed)),
                at: undefined,
              };

        const head = yield* snapshots
          .take(repo, `Fern: Walkthrough of Session ${sessionId}`)
          .pipe(Effect.mapError(gitFailed));
        const patch = yield* snapshots
          .diff(repo, base.tree, head.tree)
          .pipe(Effect.mapError(gitFailed));
        if (patch.length === 0)
          return yield* new NothingToReview({ sessionId });

        const id = crypto.randomUUID();
        yield* snapshots
          .pin(repo, walkthroughRef(id), head.commit)
          .pipe(Effect.mapError(gitFailed));
        const overlapping =
          base.at === undefined
            ? []
            : yield* turns.overlapping(repo, base.at, sessionId);
        const prepared = requestOf(
          sessionId,
          cwd,
          base.since,
          patch,
          rows,
          yield* citable(sessionId, repo),
        );
        yield* insert(
          { session: sessionId },
          {
            id,
            repo,
            since: base.since,
            prId: null,
            baseTree: base.tree,
            headCommit: head.commit,
            headTree: head.tree,
            overlapping,
            mergeBase: null,
          },
          prepared.hunks,
        );
        return { id, ...prepared };
      });

      // Starts the writer on what was stored, behind any of its Session's or PR's being written.
      const begin = (job: Writing) =>
        bump.pipe(
          Effect.andThen(FiberMap.run(forks, job.id, compose(job))),
          Effect.asVoid,
        );
      const start = (prepared: Parameters<typeof forkWriting>[0]) =>
        begin(forkWriting(prepared));

      const write = Effect.fn("Walkthroughs.write")(function* (
        sessionId: string,
      ) {
        if (writing.has(sessionId))
          return yield* new WalkthroughInProgress({ sessionId });
        yield* started(sessionId);
        const prepared = yield* prepare(sessionId).pipe(
          Effect.onError(() => done(sessionId)),
        );
        return yield* start(prepared);
      });

      // A PR's change is between two commits Fern already has, so there's no snapshot to take and
      // nothing from other Sessions to tell apart.
      const preparePr = Effect.fn("Walkthroughs.preparePr")(function* (
        sessionId: string,
        pr: PrChange,
      ) {
        const since = pr.since ?? "pr";
        const repo = yield* snapshots
          .repo(pr.cwd)
          .pipe(Effect.mapError(gitFailed));
        const [baseTree, headTree] = yield* Effect.all([
          snapshots.treeOf(repo, pr.from),
          snapshots.treeOf(repo, pr.to),
        ]).pipe(Effect.mapError(gitFailed));
        const patch = yield* snapshots
          .diff(repo, pr.from, pr.to)
          .pipe(Effect.mapError(gitFailed));
        if (patch.length === 0)
          return yield* new NothingToReview({ sessionId });
        const id = crypto.randomUUID();
        yield* snapshots
          .pin(repo, walkthroughRef(id), pr.to)
          .pipe(Effect.mapError(gitFailed));
        const rows = yield* load({ session: sessionId });
        const prepared = requestOf(
          sessionId,
          pr.cwd,
          since,
          patch,
          rows,
          yield* citable(sessionId, repo),
        );
        yield* insert(
          { session: sessionId },
          {
            id,
            repo,
            since,
            prId: pr.id,
            baseTree,
            headCommit: pr.to,
            headTree,
            overlapping: [],
            mergeBase: null,
          },
          prepared.hunks,
        );
        return { id, ...prepared };
      });

      // A Foreign PR's change is between two commits of the PR's own worktree, read by a fresh
      // writer in it. Its Sections may cite the Project's Decisions, and its Rejections are the
      // developer's own notes on its earlier Walkthroughs.
      const prepareForeign = Effect.fn("Walkthroughs.prepareForeign")(
        function* (change: ForeignChange) {
          const owner = { repo: change.pr.repo, number: change.pr.number };
          const repo = yield* snapshots
            .repo(change.cwd)
            .pipe(Effect.mapError(gitFailed));
          const [baseTree, headTree] = yield* Effect.all([
            snapshots.treeOf(repo, change.from),
            snapshots.treeOf(repo, change.to),
          ]).pipe(Effect.mapError(gitFailed));
          const patch = yield* snapshots
            .diff(repo, change.from, change.to)
            .pipe(Effect.mapError(gitFailed));
          if (patch.length === 0)
            return yield* new PrNothingToReview({ number: change.pr.number });
          const id = crypto.randomUUID();
          yield* snapshots
            .pin(repo, walkthroughRef(id), change.to)
            .pipe(Effect.mapError(gitFailed));
          const rows = yield* load(owner);
          const { hunks, rejections, asked } = askingOf(
            patch,
            rows,
            yield* decisionsOfProject(change.project).pipe(Effect.orDie),
          );
          yield* insert(
            owner,
            {
              id,
              // The Project, for a Walkthrough with no Session's folder behind it.
              repo: change.project,
              since: change.since,
              prId: null,
              baseTree,
              headCommit: change.to,
              headTree,
              overlapping: [],
              mergeBase: change.mergeBase,
            },
            hunks,
          );
          return {
            id,
            key: keyOf(owner),
            queue: change.queue,
            fork: writer.explore({
              cwd: change.cwd,
              since: change.since,
              pr: change.pr,
              ...asked,
            }),
            ids: hunks.map((hunk) => hunk.id),
            decisions: asked.decisions,
            rejections,
            after: Effect.void,
            late: "The writer took too long.",
          } satisfies Writing;
        },
      );

      const writeForeign = Effect.fn("Walkthroughs.writeForeign")(function* (
        change: ForeignChange,
      ) {
        const queued = keyOf({
          repo: change.pr.repo,
          number: change.pr.number,
        });
        if (writing.has(queued))
          return yield* new PrWalkthroughInProgress({
            number: change.pr.number,
          });
        yield* started(queued);
        const prepared = yield* prepareForeign(change).pipe(
          Effect.onError(() => done(queued)),
        );
        return yield* begin(prepared);
      });

      const writePr = Effect.fn("Walkthroughs.writePr")(function* (
        sessionId: string,
        pr: PrChange,
      ) {
        yield* started(sessionId);
        const prepared = yield* preparePr(sessionId, pr).pipe(
          Effect.onError(() => done(sessionId)),
        );
        yield* start(prepared);
      });

      // Sends the Walkthrough's Rejection notes to the Session and records how that went.
      const sendRedirect = Effect.fn("Walkthroughs.sendRedirect")(function* (
        walkthroughId: string,
        sessionId: string,
      ) {
        const rows = yield* load({ session: sessionId });
        const walkthrough = rows.walkthroughs.find(
          (w) => w.id === walkthroughId,
        );
        const text = walkthrough
          ? redirectMessage(walkthrough.number, rows, walkthroughId)
          : undefined;
        if (text === undefined) return;
        yield* turns.send(sessionId, { text }).pipe(
          Effect.mapError((error) =>
            error._tag === "TranscriptError"
              ? new WalkthroughError({ message: error.message })
              : error,
          ),
          Effect.tap(() =>
            Clock.currentTimeMillis.pipe(
              Effect.flatMap((now) =>
                record(sql`UPDATE walkthroughs SET redirect_sent_at = ${now},
                  redirect_error = NULL WHERE id = ${walkthroughId}`),
              ),
            ),
          ),
          // The Rejections are the developer's Redirect.
          Effect.tap(() => autonomy.redirected(sessionId, "rejection")),
          Effect.tapError((error) =>
            record(sql`UPDATE walkthroughs SET redirect_error = ${redirectFailure(error)}
              WHERE id = ${walkthroughId}`),
          ),
        );
      });

      // Whose change the Walkthrough explains.
      const findOwner = (walkthroughId: string) =>
        ownerRow(walkthroughId).pipe(
          Effect.orDie,
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(new WalkthroughNotFound({ id: walkthroughId })),
              onSome: ({
                sessionId,
                prRepo,
                prNumber,
              }): Effect.Effect<Owner> =>
                sessionId !== null
                  ? Effect.succeed({ session: sessionId })
                  : prRepo !== null && prNumber !== null
                    ? Effect.succeed({ repo: prRepo, number: prNumber })
                    : Effect.die(
                        `Walkthrough ${walkthroughId} has neither a Session nor a PR`,
                      ),
            }),
          ),
        );

      const verdict = Effect.fn("Walkthroughs.verdict")(function* (
        walkthroughId: string,
        item: string,
        input: VerdictInput,
      ) {
        const owner = yield* findOwner(walkthroughId);
        const reviewed = yield* reviewing.withPermits(1)(
          Effect.gen(function* () {
            const rows = yield* load(owner);
            const walkthrough = rows.walkthroughs.find(
              (w) => w.id === walkthroughId,
            );
            if (
              walkthrough === undefined ||
              walkthrough.status !== "ready" ||
              walkthrough.reviewedAt !== null
            )
              return yield* new ReviewClosed({ id: walkthroughId });
            const section = rows.sections.find(
              (s) => s.walkthroughId === walkthroughId && s.id === item,
            );
            const unexplained = rows.hunks.find(
              (h) =>
                h.walkthroughId === walkthroughId &&
                h.id === item &&
                h.sectionId === null,
            );
            if (!section && !unexplained)
              return yield* new ReviewItemNotFound({ id: item });

            const now = yield* Clock.currentTimeMillis;
            const note =
              input.kind === "rejected" ? (input.note ?? "").trim() : null;
            const table = section
              ? sql`walkthrough_sections`
              : sql`walkthrough_hunks`;
            yield* sql`UPDATE ${table} SET verdict = ${input.kind}, note = ${note},
              decided_at = ${now} WHERE walkthrough_id = ${walkthroughId} AND id = ${item}`;

            const after = yield* load(owner);
            const open =
              after.sections.some(
                (s) => s.walkthroughId === walkthroughId && s.verdict === null,
              ) ||
              after.hunks.some(
                (h) =>
                  h.walkthroughId === walkthroughId &&
                  h.sectionId === null &&
                  h.verdict === null,
              );
            if (!open)
              yield* sql`UPDATE walkthroughs SET reviewed_at = ${now} WHERE id = ${walkthroughId}`;
            yield* bump;
            return !open;
          }).pipe(Effect.catchTag("SqlError", Effect.die)),
        );
        // A failed send is recorded on the Walkthrough for the developer to retry; the verdict
        // stands. A Foreign PR's Rejections go nowhere until the developer posts a review.
        if (reviewed && "session" in owner)
          yield* sendRedirect(walkthroughId, owner.session).pipe(Effect.ignore);
      });

      // A Foreign PR's Walkthrough has no Session to send its Rejections to, so it's never open
      // for this.
      const redirect = Effect.fn("Walkthroughs.redirect")(function* (
        walkthroughId: string,
      ) {
        const owner = yield* findOwner(walkthroughId);
        if (!("session" in owner))
          return yield* new ReviewClosed({ id: walkthroughId });
        const rows = yield* load(owner);
        const walkthrough = rows.walkthroughs.find(
          (w) => w.id === walkthroughId,
        );
        if (walkthrough?.reviewedAt === null || walkthrough === undefined)
          return yield* new ReviewClosed({ id: walkthroughId });
        return yield* sendRedirect(walkthroughId, owner.session);
      });

      // A PR's Walkthrough Fern was writing when it stopped is written now, as its change is
      // stored with it. Nothing else would write it, and the Stack waits on it.
      const unfinished = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({
          id: Schema.String,
          sessionId: Schema.String,
          repo: Schema.String,
          since: WalkthroughSince,
        }),
        execute: () => sql`
          SELECT id, session_id, repo, since FROM walkthroughs
          WHERE status = 'writing' AND pr_id IS NOT NULL AND session_id IS NOT NULL
          ORDER BY created_at, number`,
      });
      const resume = Effect.fn("Walkthroughs.resume")(function* (walkthrough: {
        readonly id: string;
        readonly sessionId: string;
        readonly repo: string;
        readonly since: WalkthroughSince;
      }) {
        const { id, sessionId } = walkthrough;
        const info = yield* sdk("getSessionInfo", () =>
          getSessionInfo(sessionId),
        ).pipe(Effect.orElseSucceed(() => undefined));
        const rows = yield* load({ session: sessionId });
        // Stored in the order they were numbered, so they number the same again.
        const stored = rows.hunks.filter((h) => h.walkthroughId === id);
        const prepared = requestOf(
          sessionId,
          info?.cwd ?? walkthrough.repo,
          walkthrough.since,
          stored,
          rows,
          yield* citable(sessionId, walkthrough.repo),
        );
        yield* started(sessionId);
        yield* start({ id, ...prepared });
      });
      // A Foreign PR's Walkthrough Fern was writing when it stopped fails instead: its PR may have
      // moved on since, and the developer walks through it again when they want it.
      yield* sql`UPDATE walkthroughs SET status = 'failed', error = ${STOPPED}
        WHERE status = 'writing' AND pr_number IS NOT NULL`.pipe(Effect.orDie);
      yield* unfinished().pipe(
        Effect.orDie,
        Effect.flatMap((rows) => Effect.forEach(rows, resume)),
      );

      const walkthroughRow = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Schema.Struct({
          id: Schema.String,
          sessionId: Schema.NullOr(Schema.String),
          repo: Schema.String,
          since: WalkthroughSince,
          status: WalkthroughStatus,
          prId: Schema.NullOr(Schema.String),
        }),
        execute: (id) =>
          sql`SELECT id, session_id, repo, since, status, pr_id FROM walkthroughs WHERE id = ${id}`,
      });
      // Its change is stored with it, so it's written again the way Fern resumes one after a
      // restart. A snapshot Walkthrough isn't: the next one covers what it missed. Nor is a
      // Foreign PR's: walking through the PR again replaces it.
      const rewrite = Effect.fn("Walkthroughs.rewrite")(function* (
        walkthroughId: string,
      ) {
        const found = yield* walkthroughRow(walkthroughId).pipe(Effect.orDie);
        if (Option.isNone(found))
          return yield* new WalkthroughNotFound({ id: walkthroughId });
        const { status, prId, sessionId } = found.value;
        if (status !== "failed" || prId === null || sessionId === null)
          return yield* new NotRewritable({ id: walkthroughId });
        yield* sql`UPDATE walkthroughs SET status = 'writing', error = NULL
          WHERE id = ${walkthroughId}`.pipe(Effect.orDie);
        return yield* resume({ ...found.value, sessionId });
      }, reviewing.withPermits(1));

      const rejectionsOf = (sessionId: string) =>
        load({ session: sessionId }).pipe(
          Effect.map((rows) =>
            openRejections(rows).map(({ walkthroughId, title }) => ({
              walkthroughId,
              title,
            })),
          ),
        );

      // Whether the Session's work lands as a Stack: it has PRs up already, or would put them up.
      const stackUp = SqlSchema.findAll({
        Request: Schema.String,
        Result: Schema.Struct({ id: Schema.String }),
        execute: (sessionId) =>
          sql`SELECT id FROM stack_prs WHERE session_id = ${sessionId} LIMIT 1`,
      });
      const landsAsStack = (sessionId: string) =>
        stackUp(sessionId).pipe(
          Effect.orDie,
          Effect.flatMap((up) =>
            up.length > 0 ? Effect.succeed(true) : stacks.applies(sessionId),
          ),
        );

      // Fern writes a Walkthrough whenever a turn it ran finishes on its own, except where the
      // Session's work lands as a Stack: there each PR gets its own, as its ticket lands, or, without
      // tickets, as Stacks writes the one PR's.
      yield* turns.finished.pipe(
        Stream.runForEach(({ id }) =>
          Effect.when(
            write(id),
            landsAsStack(id).pipe(Effect.map((stack) => !stack)),
          ).pipe(
            Effect.catchTags({
              NothingToReview: () => Effect.void,
              WalkthroughInProgress: () => Effect.void,
            }),
            Effect.catch((error) =>
              Effect.logWarning(
                "Couldn't write a Walkthrough",
                failureMessage(error),
              ),
            ),
          ),
        ),
        Effect.forkScoped,
      );

      return Walkthroughs.of({
        list,
        write,
        writePr,
        verdict,
        redirect,
        rewrite,
        listForeign,
        writeForeign,
        foreignStates,
        lastWritten,
        liveForeignStates,
        openRejections: rejectionsOf,
      });
    }),
  );
}
