import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, String } from "effect";
import { SqlClient, type SqlError } from "effect/sql";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseLive, migrations } from "../src/database/Database";

const client = (filename: string) =>
  SqliteClient.layer({
    filename,
    transformResultNames: String.snakeToCamel,
    transformQueryNames: String.camelToSnake,
  });

// Fern's database as it was before Walkthroughs could explain a Foreign PR: every migration up to
// 0017.
const before = (filename: string) =>
  SqliteMigrator.layer({
    loader: SqliteMigrator.fromRecord(
      Object.fromEntries(
        Object.entries(migrations).filter(([id]) => id <= "0017"),
      ),
    ),
  }).pipe(Layer.provideMerge(client(filename)));

const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO stack_prs ${sql.insert({
    id: "pr-1",
    sessionId: "session-1",
    position: 1,
    ticket: 3,
    title: "Add the theme setting",
    mergeCommit: "c0ffee",
    branch: "dark-mode/3",
    base: "main",
    number: 101,
    url: "https://github.com/acme/app/pull/101",
    createdAt: 1,
    kind: "ticket",
  })}`;
  for (const [id, number, prId] of [
    ["w1", 1, null],
    ["w2", 2, "pr-1"],
  ] as const)
    yield* sql`INSERT INTO walkthroughs ${sql.insert({
      id,
      sessionId: "session-1",
      repo: "/repo",
      number,
      status: "ready",
      error: null,
      since: number === 1 ? "start" : "pr",
      baseTree: `base-${id}`,
      headCommit: `head-${id}`,
      headTree: `tree-${id}`,
      overlapping: '["other"]',
      createdAt: 10 + number,
      reviewedAt: 20 + number,
      redirectSentAt: 30,
      redirectError: null,
      prId,
    })}`;
  yield* sql`INSERT INTO walkthrough_sections ${sql.insert({
    walkthroughId: "w2",
    id: "s1",
    position: 0,
    title: "The theme",
    explanation: "Adds it.",
    dropped: "Tried CSS variables.",
    fixesWalkthroughId: "w1",
    fixesItemId: "h1",
    verdict: "rejected",
    note: "Smaller, please.",
    decidedAt: 40,
    decisions: '["d1"]',
    risk: "high",
    riskReason: "A migration.",
  })}`;
  yield* sql`INSERT INTO walkthrough_hunks ${sql.insert({
    walkthroughId: "w1",
    id: "h1",
    position: 0,
    path: "a.ts",
    header: "@@ -1 +1 @@",
    lines: '["-a","+b"]',
    added: 1,
    removed: 1,
    sectionId: null,
    notFromSession: 1,
    verdict: "rejected",
    note: "Revert this.",
    decidedAt: 41,
  })}`;
  yield* sql`INSERT INTO walkthrough_hunks ${sql.insert({
    walkthroughId: "w2",
    id: "h1",
    position: 0,
    path: "theme.ts",
    header: "@@ -0,0 +1 @@",
    lines: '["+x"]',
    added: 1,
    removed: 0,
    sectionId: "s1",
    notFromSession: 0,
    verdict: null,
    note: null,
    decidedAt: null,
  })}`;
});

// Runs the effect on its own run of the layer, shut down after.
const on = <A, E, R, LE>(
  database: Layer.Layer<R, LE>,
  effect: Effect.Effect<A, E, R>,
) =>
  Layer.build(database).pipe(
    Effect.flatMap((context) => effect.pipe(Effect.provideContext(context))),
    Effect.scoped,
  );

// What SQLite said when it refused a statement.
const why = (error: SqlError.SqlError) => globalThis.String(error.reason.cause);

const file = join(mkdtempSync(join(tmpdir(), "fern-db-")), "fern.db");

it.effect(
  "Walkthroughs written before Foreign PRs keep every row, Section, hunk and verdict once a Walkthrough can have no Session",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const walkthroughs = yield* sql`SELECT * FROM walkthroughs ORDER BY id`;
      assert.deepStrictEqual(
        walkthroughs.map((w) => ({ ...w })),
        [
          {
            id: "w1",
            sessionId: "session-1",
            repo: "/repo",
            number: 1,
            status: "ready",
            error: null,
            since: "start",
            baseTree: "base-w1",
            headCommit: "head-w1",
            headTree: "tree-w1",
            overlapping: '["other"]',
            createdAt: 11,
            reviewedAt: 21,
            redirectSentAt: 30,
            redirectError: null,
            prId: null,
            prRepo: null,
            prNumber: null,
            mergeBase: null,
          },
          {
            id: "w2",
            sessionId: "session-1",
            repo: "/repo",
            number: 2,
            status: "ready",
            error: null,
            since: "pr",
            baseTree: "base-w2",
            headCommit: "head-w2",
            headTree: "tree-w2",
            overlapping: '["other"]',
            createdAt: 12,
            reviewedAt: 22,
            redirectSentAt: 30,
            redirectError: null,
            prId: "pr-1",
            prRepo: null,
            prNumber: null,
            mergeBase: null,
          },
        ],
      );
      const [section] = yield* sql`SELECT * FROM walkthrough_sections`;
      assert.deepStrictEqual(
        { ...section },
        {
          walkthroughId: "w2",
          id: "s1",
          position: 0,
          title: "The theme",
          explanation: "Adds it.",
          dropped: "Tried CSS variables.",
          fixesWalkthroughId: "w1",
          fixesItemId: "h1",
          verdict: "rejected",
          note: "Smaller, please.",
          decidedAt: 40,
          decisions: '["d1"]',
          risk: "high",
          riskReason: "A migration.",
        },
      );
      const hunks =
        yield* sql`SELECT * FROM walkthrough_hunks ORDER BY walkthrough_id`;
      assert.deepStrictEqual(
        hunks.map((h) => ({ ...h })),
        [
          {
            walkthroughId: "w1",
            id: "h1",
            position: 0,
            path: "a.ts",
            header: "@@ -1 +1 @@",
            lines: '["-a","+b"]',
            added: 1,
            removed: 1,
            sectionId: null,
            notFromSession: 1,
            verdict: "rejected",
            note: "Revert this.",
            decidedAt: 41,
          },
          {
            walkthroughId: "w2",
            id: "h1",
            position: 0,
            path: "theme.ts",
            header: "@@ -0,0 +1 @@",
            lines: '["+x"]',
            added: 1,
            removed: 0,
            sectionId: "s1",
            notFromSession: 0,
            verdict: null,
            note: null,
            decidedAt: null,
          },
        ],
      );
      assert.deepStrictEqual(yield* sql`PRAGMA foreign_key_check`, []);

      // Still enforced: a Section of no Walkthrough, a Walkthrough of a PR not on a Stack.
      const orphan = yield* sql`INSERT INTO walkthrough_sections ${sql.insert({
        walkthroughId: "nowhere",
        id: "s1",
        position: 0,
        title: "Orphan",
        explanation: "",
      })}`.pipe(Effect.flip);
      assert.include(why(orphan), "FOREIGN KEY");

      const row = (fields: Record<string, unknown>) =>
        sql`INSERT INTO walkthroughs ${sql.insert({
          id: crypto.randomUUID(),
          repo: "/repo",
          number: 1,
          status: "writing",
          since: "pr",
          baseTree: "b",
          headCommit: "h",
          headTree: "t",
          createdAt: 1,
          ...fields,
        })}`;
      // A Foreign PR's Walkthrough has no Session, and is numbered per PR.
      yield* row({ prRepo: "acme/app", prNumber: 7, mergeBase: "m" });
      yield* row({ prRepo: "acme/app", prNumber: 8, mergeBase: "m" });
      const twice = yield* row({ prRepo: "acme/app", prNumber: 7 }).pipe(
        Effect.flip,
      );
      assert.include(why(twice), "UNIQUE");
      // Exactly one of a Session and a Foreign PR.
      const neither = yield* row({}).pipe(Effect.flip);
      assert.include(why(neither), "CHECK");
      const both = yield* row({
        sessionId: "session-2",
        prRepo: "acme/app",
        prNumber: 9,
      }).pipe(Effect.flip);
      assert.include(why(both), "CHECK");
    }).pipe((migrated) =>
      on(before(file), seed).pipe(
        Effect.andThen(on(DatabaseLive(file), migrated)),
      ),
    ),
);
