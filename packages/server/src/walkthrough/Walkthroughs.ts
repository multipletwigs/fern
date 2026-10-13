import { getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import {
  CitedDecision,
  Hunk,
  NothingToReview,
  PullRequest,
  ReviewClosed,
  ReviewItemNotFound,
  RiskLevel,
  RoundQuestion,
  Section,
  type SessionBusy,
  type SessionInUse,
  SessionNotFound,
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
  type OpenRejection,
  WalkthroughWriter,
} from "./WalkthroughWriter";

// Lines sent per hunk; the rest are counted in `omitted`.
const MAX_HUNK_LINES = 400;
const WRITE_TIMEOUT = Duration.minutes(10);

const WalkthroughRow = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  number: Schema.Int,
  status: WalkthroughStatus,
  error: Schema.NullOr(Schema.String),
  since: WalkthroughSince,
  prId: Schema.NullOr(Schema.String),
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
      sessionId: w.sessionId,
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
            unplanned: s.decisions !== null && s.decisions.length === 0,
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
  const ask = rows.walkthroughs.some(
    (w) => w.id === walkthroughId && w.prId !== null,
  )
    ? "Please address these: commit the fix on this Session's branch, then report it with Fern's `fix_landed` tool, which puts it up as a new PR on top of the Stack."
    : "Please address these.";
  return `I reviewed Walkthrough ${number} and rejected part of it:\n\n${lines.join("\n")}\n\n${ask}`;
};

// What the Fork is asked to explain, numbered, the Rejections it may say it fixes, and the
// Project's Decisions it may cite.
const requestOf = (
  sessionId: string,
  cwd: string,
  since: WalkthroughSince,
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
    request: {
      sessionId,
      cwd,
      since,
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
    // Starts writing the Walkthrough of one PR of the Session's Stack: the change from the commit
    // `from` to the commit `to`. Fern writes a Session's Walkthroughs one at a time, so it waits its
    // turn behind any being written; until then it shows as being written.
    writePr(
      sessionId: string,
      pr: {
        readonly id: string;
        readonly cwd: string;
        readonly from: string;
        readonly to: string;
      },
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

      const walkthroughsOf = SqlSchema.findAll({
        Request: Schema.String,
        Result: WalkthroughRow,
        execute: (sessionId) =>
          sql`SELECT * FROM walkthroughs WHERE session_id = ${sessionId} ORDER BY number`,
      });
      const sectionsOf = SqlSchema.findAll({
        Request: Schema.String,
        Result: SectionRow,
        execute: (sessionId) => sql`
          SELECT s.* FROM walkthrough_sections s
          JOIN walkthroughs w ON w.id = s.walkthrough_id
          WHERE w.session_id = ${sessionId}
          ORDER BY s.position`,
      });
      const hunksOf = SqlSchema.findAll({
        Request: Schema.String,
        Result: HunkRow,
        execute: (sessionId) => sql`
          SELECT h.* FROM walkthrough_hunks h
          JOIN walkthroughs w ON w.id = h.walkthrough_id
          WHERE w.session_id = ${sessionId}
          ORDER BY h.position`,
      });
      const prsOf = SqlSchema.findAll({
        Request: Schema.String,
        Result: PrRow,
        execute: (sessionId) => sql`
          SELECT id, number, url, title, position, ticket FROM stack_prs
          WHERE session_id = ${sessionId} ORDER BY position`,
      });
      const sessionOf = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Schema.Struct({ sessionId: Schema.String }),
        execute: (id) =>
          sql`SELECT session_id FROM walkthroughs WHERE id = ${id}`,
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

      const load = (sessionId: string) =>
        Effect.gen(function* () {
          const rows = yield* Effect.all({
            walkthroughs: walkthroughsOf(sessionId),
            sections: sectionsOf(sessionId),
            hunks: hunksOf(sessionId),
            prs: prsOf(sessionId),
          });
          const cited = [
            ...new Set(rows.sections.flatMap((s) => s.decisions ?? [])),
          ];
          const decisions =
            cited.length === 0 ? [] : yield* decisionsById(cited);
          return { ...rows, decisions };
        }).pipe(Effect.orDie);

      const list = (sessionId: string) =>
        SubscriptionRef.changes(version).pipe(
          Stream.mapEffect(() => load(sessionId)),
          Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
          Stream.map(assemble),
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

      // Makes a PR's Walkthrough, once written, the PR's description, so GitHub never shows a stale
      // one. A failed Walkthrough leaves the description as it was; so does a code host that can't
      // be reached, until the next Walkthrough of the PR.
      const describe = (
        walkthroughId: string,
        sessionId: string,
        cwd: string,
      ) =>
        Effect.gen(function* () {
          const walkthrough = assemble(yield* load(sessionId)).find(
            (w) => w.id === walkthroughId,
          );
          if (walkthrough?.status !== "ready" || walkthrough.pr === undefined)
            return;
          yield* codeHost
            .setBody(cwd, walkthrough.pr.number, prDescription(walkthrough))
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning(
                  `Couldn't update PR #${walkthrough.pr?.number ?? "?"}'s description`,
                  error.message,
                ),
              ),
            );
        });

      // Runs the Fork and stores what it wrote, giving it one retry to claim what it left out.
      const compose = (
        walkthroughId: string,
        request: Parameters<typeof writer.write>[0],
        rejections: ReadonlyArray<
          OpenRejection & { walkthroughId: string; itemId: string }
        >,
      ) => {
        const ids = request.hunks.map((hunk) => hunk.id);
        const write = Effect.gen(function* () {
          const fork = yield* writer.write(request);
          let draft = fork.draft;
          const unclaimed = unclaimedHunks(draft, ids);
          if (unclaimed.length > 0)
            draft = yield* fork.revise(unclaimed).pipe(
              // A failed retry still leaves the first draft; what it missed shows as unexplained.
              Effect.orElseSucceed(() => draft),
            );
          yield* finish(
            walkthroughId,
            ids,
            draft,
            rejections,
            request.decisions,
          );
        }).pipe(
          Effect.scoped,
          Effect.timeoutOrElse({
            duration: WRITE_TIMEOUT,
            orElse: () =>
              Effect.fail(
                new WalkthroughError({ message: "The Fork took too long." }),
              ),
          }),
          Effect.catch((error) => fail(walkthroughId, error.message)),
        );
        return queueOf(request.sessionId).pipe(
          Effect.flatMap((queue) =>
            queue.withPermits(1)(
              write.pipe(
                Effect.andThen(
                  describe(walkthroughId, request.sessionId, request.cwd),
                ),
              ),
            ),
          ),
          Effect.ensuring(done(request.sessionId).pipe(Effect.andThen(bump))),
        );
      };

      // Stores the Walkthrough's row and its hunks, being written.
      const insert = (
        walkthrough: {
          readonly id: string;
          readonly sessionId: string;
          readonly repo: string;
          readonly since: WalkthroughSince;
          readonly prId: string | null;
          readonly baseTree: string;
          readonly headCommit: string;
          readonly headTree: string;
          readonly overlapping: ReadonlyArray<string>;
        },
        hunks: ReadonlyArray<PatchHunk & { readonly id: string }>,
      ) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          yield* sql
            .withTransaction(
              Effect.gen(function* () {
                const [last] = yield* sql<{ number: number }>`
                  SELECT MAX(number) AS number FROM walkthroughs
                  WHERE session_id = ${walkthrough.sessionId}`;
                yield* sql`INSERT INTO walkthroughs ${sql.insert({
                  ...walkthrough,
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
        const rows = yield* load(sessionId);
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
          {
            id,
            sessionId,
            repo,
            since: base.since,
            prId: null,
            baseTree: base.tree,
            headCommit: head.commit,
            headTree: head.tree,
            overlapping,
          },
          prepared.hunks,
        );
        return { id, ...prepared };
      });

      // Starts the Fork on what `prepare` stored, behind any of the Session's being written.
      const start = (prepared: {
        readonly id: string;
        readonly request: Parameters<typeof writer.write>[0];
        readonly rejections: ReturnType<typeof openRejections>;
      }) =>
        bump.pipe(
          Effect.andThen(
            FiberMap.run(
              forks,
              prepared.id,
              compose(prepared.id, prepared.request, prepared.rejections),
            ),
          ),
          Effect.asVoid,
        );

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
        pr: {
          readonly id: string;
          readonly cwd: string;
          readonly from: string;
          readonly to: string;
        },
      ) {
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
        const rows = yield* load(sessionId);
        const prepared = requestOf(
          sessionId,
          pr.cwd,
          "pr",
          patch,
          rows,
          yield* citable(sessionId, repo),
        );
        yield* insert(
          {
            id,
            sessionId,
            repo,
            since: "pr",
            prId: pr.id,
            baseTree,
            headCommit: pr.to,
            headTree,
            overlapping: [],
          },
          prepared.hunks,
        );
        return { id, ...prepared };
      });

      const writePr = Effect.fn("Walkthroughs.writePr")(function* (
        sessionId: string,
        pr: {
          readonly id: string;
          readonly cwd: string;
          readonly from: string;
          readonly to: string;
        },
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
        const rows = yield* load(sessionId);
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

      const findSession = (walkthroughId: string) =>
        sessionOf(walkthroughId).pipe(
          Effect.orDie,
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(new WalkthroughNotFound({ id: walkthroughId })),
              onSome: ({ sessionId }) => Effect.succeed(sessionId),
            }),
          ),
        );

      const verdict = Effect.fn("Walkthroughs.verdict")(function* (
        walkthroughId: string,
        item: string,
        input: VerdictInput,
      ) {
        const sessionId = yield* findSession(walkthroughId);
        const reviewed = yield* reviewing.withPermits(1)(
          Effect.gen(function* () {
            const rows = yield* load(sessionId);
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

            const after = yield* load(sessionId);
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
        // A failed send is recorded on the Walkthrough for the developer to retry; the verdict stands.
        if (reviewed)
          yield* sendRedirect(walkthroughId, sessionId).pipe(Effect.ignore);
      });

      const redirect = Effect.fn("Walkthroughs.redirect")(function* (
        walkthroughId: string,
      ) {
        const sessionId = yield* findSession(walkthroughId);
        const rows = yield* load(sessionId);
        const walkthrough = rows.walkthroughs.find(
          (w) => w.id === walkthroughId,
        );
        if (walkthrough?.reviewedAt === null || walkthrough === undefined)
          return yield* new ReviewClosed({ id: walkthroughId });
        return yield* sendRedirect(walkthroughId, sessionId);
      });

      // A PR's Walkthrough Fern was writing when it stopped is written now, as its change is
      // stored with it. Nothing else would write it, and the Stack waits on it.
      const unfinished = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({
          id: Schema.String,
          sessionId: Schema.String,
          repo: Schema.String,
        }),
        execute: () => sql`
          SELECT id, session_id, repo FROM walkthroughs
          WHERE status = 'writing' AND pr_id IS NOT NULL ORDER BY created_at, number`,
      });
      const resume = Effect.fn("Walkthroughs.resume")(function* (walkthrough: {
        readonly id: string;
        readonly sessionId: string;
        readonly repo: string;
      }) {
        const { id, sessionId } = walkthrough;
        const info = yield* sdk("getSessionInfo", () =>
          getSessionInfo(sessionId),
        ).pipe(Effect.orElseSucceed(() => undefined));
        const rows = yield* load(sessionId);
        // Stored in the order they were numbered, so they number the same again.
        const stored = rows.hunks.filter((h) => h.walkthroughId === id);
        const prepared = requestOf(
          sessionId,
          info?.cwd ?? walkthrough.repo,
          "pr",
          stored,
          rows,
          yield* citable(sessionId, walkthrough.repo),
        );
        yield* started(sessionId);
        yield* start({ id, ...prepared });
      });
      yield* unfinished().pipe(
        Effect.orDie,
        Effect.flatMap((rows) => Effect.forEach(rows, resume)),
      );

      // Fern writes a Walkthrough whenever a turn it ran finishes on its own, except where the
      // Session's work lands as a Stack: there each PR gets its own, as its ticket lands.
      yield* turns.finished.pipe(
        Stream.runForEach(({ id }) =>
          Effect.when(
            write(id),
            stacks.applies(id).pipe(Effect.map((applies) => !applies)),
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

      return Walkthroughs.of({ list, write, writePr, verdict, redirect });
    }),
  );
}
