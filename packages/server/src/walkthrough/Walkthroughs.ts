import { getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import {
  Hunk,
  NothingToReview,
  ReviewClosed,
  ReviewItemNotFound,
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
import type { GitError } from "../git/Git";
import { Snapshots, walkthroughRef } from "../snapshot/Snapshots";
import { Turns } from "../turn/Turns";
import { settle, unclaimedHunks } from "./coverage";
import { type OpenRejection, WalkthroughWriter } from "./WalkthroughWriter";

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
  ...VerdictColumns,
});
type SectionRow = typeof SectionRow.Type;

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

interface SessionRows {
  readonly walkthroughs: ReadonlyArray<WalkthroughRow>;
  readonly sections: ReadonlyArray<SectionRow>;
  readonly hunks: ReadonlyArray<HunkRow>;
}

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
  return lines.length === 0
    ? undefined
    : `I reviewed Walkthrough ${number} and rejected part of it:\n\n${lines.join("\n")}\n\nPlease address these.`;
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
      // Bumped after every write, so open lists reload.
      const version = yield* SubscriptionRef.make(0);
      const bump = SubscriptionRef.update(version, (n) => n + 1);
      const record = (update: SqlStatement.Statement<unknown>) =>
        update.pipe(Effect.orDie, Effect.andThen(bump));
      // Sessions with a Walkthrough being written.
      const writing = new Set<string>();
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
      const sessionOf = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Schema.Struct({ sessionId: Schema.String }),
        execute: (id) =>
          sql`SELECT session_id FROM walkthroughs WHERE id = ${id}`,
      });

      const load = (sessionId: string) =>
        Effect.all({
          walkthroughs: walkthroughsOf(sessionId),
          sections: sectionsOf(sessionId),
          hunks: hunksOf(sessionId),
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
      ) {
        const { sections, notFromSession } = settle(draft, hunkIds);
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

      // Runs the Fork and stores what it wrote, giving it one retry to claim what it left out.
      const compose = (
        walkthroughId: string,
        request: Parameters<typeof writer.write>[0],
        rejections: ReadonlyArray<
          OpenRejection & { walkthroughId: string; itemId: string }
        >,
      ) => {
        const ids = request.hunks.map((hunk) => hunk.id);
        return Effect.gen(function* () {
          const fork = yield* writer.write(request);
          let draft = fork.draft;
          const unclaimed = unclaimedHunks(draft, ids);
          if (unclaimed.length > 0)
            draft = yield* fork.revise(unclaimed).pipe(
              // A failed retry still leaves the first draft; what it missed shows as unexplained.
              Effect.orElseSucceed(() => draft),
            );
          yield* finish(walkthroughId, ids, draft, rejections);
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
          Effect.ensuring(
            Effect.sync(() => writing.delete(request.sessionId)).pipe(
              Effect.andThen(bump),
            ),
          ),
        );
      };

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
        const now = yield* Clock.currentTimeMillis;
        const hunks = patch.map((hunk, index) => ({
          ...hunk,
          id: `h${index + 1}`,
        }));

        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`INSERT INTO walkthroughs ${sql.insert({
                id,
                sessionId,
                repo,
                number: (rows.walkthroughs.at(-1)?.number ?? 0) + 1,
                status: "writing",
                since: base.since,
                baseTree: base.tree,
                headCommit: head.commit,
                headTree: head.tree,
                overlapping: JSON.stringify(overlapping),
                createdAt: now,
              })}`;
              for (const [position, hunk] of hunks.entries())
                yield* sql`INSERT INTO walkthrough_hunks ${sql.insert({
                  walkthroughId: id,
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

        const rejections = openRejections(rows);
        return {
          id,
          rejections,
          request: {
            sessionId,
            cwd,
            since: base.since,
            hunks,
            rejections: rejections.map((r) => ({
              id: r.id,
              title: r.title,
              note: r.note,
            })),
          },
        };
      });

      const write = Effect.fn("Walkthroughs.write")(function* (
        sessionId: string,
      ) {
        if (writing.has(sessionId))
          return yield* new WalkthroughInProgress({ sessionId });
        writing.add(sessionId);
        const prepared = yield* prepare(sessionId).pipe(
          Effect.onError(() => Effect.sync(() => writing.delete(sessionId))),
        );
        yield* bump;
        return yield* FiberMap.run(
          forks,
          sessionId,
          compose(prepared.id, prepared.request, prepared.rejections),
        ).pipe(Effect.asVoid);
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

      // Fern writes a Walkthrough whenever a turn it ran finishes on its own.
      yield* turns.finished.pipe(
        Stream.runForEach(({ id }) =>
          write(id).pipe(
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

      return Walkthroughs.of({ list, write, verdict, redirect });
    }),
  );
}
