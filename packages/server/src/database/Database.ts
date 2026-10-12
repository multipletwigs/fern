import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Effect, Layer, String } from "effect";
import { SqlClient } from "effect/sql";

// Fern's records in one local SQLite file (ADR 0004). Migrations only run up, at startup, in id
// order; add new ones at the end and never edit one that has shipped.
const migrations = {
  "0001_walkthroughs": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE walkthroughs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        repo TEXT NOT NULL,
        number INTEGER NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        since TEXT NOT NULL,
        base_tree TEXT NOT NULL,
        head_commit TEXT NOT NULL,
        head_tree TEXT NOT NULL,
        overlapping TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        reviewed_at INTEGER,
        redirect_sent_at INTEGER,
        redirect_error TEXT,
        UNIQUE (session_id, number)
      )
    `;
    yield* sql`
      CREATE TABLE walkthrough_sections (
        walkthrough_id TEXT NOT NULL REFERENCES walkthroughs (id),
        id TEXT NOT NULL,
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        explanation TEXT NOT NULL,
        dropped TEXT,
        fixes_walkthrough_id TEXT,
        fixes_item_id TEXT,
        verdict TEXT,
        note TEXT,
        decided_at INTEGER,
        PRIMARY KEY (walkthrough_id, id)
      )
    `;
    // A hunk with no section_id once the Walkthrough is written is an Unexplained change, and takes
    // its own verdict.
    yield* sql`
      CREATE TABLE walkthrough_hunks (
        walkthrough_id TEXT NOT NULL REFERENCES walkthroughs (id),
        id TEXT NOT NULL,
        position INTEGER NOT NULL,
        path TEXT NOT NULL,
        header TEXT NOT NULL,
        lines TEXT NOT NULL,
        added INTEGER NOT NULL,
        removed INTEGER NOT NULL,
        section_id TEXT,
        not_from_session INTEGER NOT NULL DEFAULT 0,
        verdict TEXT,
        note TEXT,
        decided_at INTEGER,
        PRIMARY KEY (walkthrough_id, id)
      )
    `;
  }),
  // Sessions Fern started, which Claude Code records as headless and its own listing leaves out.
  "0002_hosted_sessions": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE hosted_sessions (
        id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        started_at INTEGER NOT NULL
      )
    `;
  }),
  // A Hosted Session runs in a worktree of its own (ADR 0005): `cwd` is then inside the worktree,
  // and the Session is listed under the Project it was started from. Sessions started before have
  // none of these.
  "0003_hosted_session_worktrees": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`ALTER TABLE hosted_sessions ADD COLUMN project_root TEXT`;
    yield* sql`ALTER TABLE hosted_sessions ADD COLUMN branch TEXT`;
    yield* sql`ALTER TABLE hosted_sessions ADD COLUMN worktree TEXT`;
    yield* sql`ALTER TABLE hosted_sessions ADD COLUMN base_commit TEXT`;
  }),
  // When a Session was archived, by the developer or because its branch merged. Its worktree is
  // gone and the sidebar leaves it out.
  "0004_archived_sessions": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`ALTER TABLE hosted_sessions ADD COLUMN archived_at INTEGER`;
  }),
  // Each Hosted Session's Flow: its Phases' statuses, written once the Flow first moves on (a
  // Session with no row is in the Grill), and the Checkpoints raised at the end of each Phase.
  "0005_flows": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE flows (
        session_id TEXT PRIMARY KEY,
        phases TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
    yield* sql`
      CREATE TABLE checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT,
        raised_at INTEGER NOT NULL,
        decided_at INTEGER
      )
    `;
  }),
  // Rounds the agent asks during Grill, and the Decisions settled by answering them. A Round is
  // open until it's answered or the agent posts another in its place.
  "0006_rounds": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE rounds (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        questions TEXT NOT NULL,
        posted_at INTEGER NOT NULL,
        answered_at INTEGER,
        superseded_at INTEGER
      )
    `;
    yield* sql`CREATE INDEX rounds_by_session ON rounds (session_id)`;
    yield* sql`
      CREATE TABLE decisions (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        session_id TEXT NOT NULL,
        round_id TEXT NOT NULL REFERENCES rounds (id),
        question_id TEXT NOT NULL,
        question TEXT NOT NULL,
        choice TEXT,
        free_text TEXT,
        recommended INTEGER NOT NULL,
        decided_at INTEGER NOT NULL
      )
    `;
    yield* sql`CREATE INDEX decisions_by_session ON decisions (session_id)`;
    yield* sql`CREATE INDEX decisions_by_project ON decisions (project)`;
  }),
  // Phases the developer skipped, with their reasons: the Session's record of every Skip.
  "0007_skips": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE skips (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        reason TEXT NOT NULL,
        skipped_at INTEGER NOT NULL
      )
    `;
  }),
};

// The database at `filename`, migrated. Columns are snake_case in SQL and camelCase in code.
export const DatabaseLive = (filename: string) =>
  SqliteMigrator.layer({
    loader: SqliteMigrator.fromRecord(migrations),
  }).pipe(
    Layer.provideMerge(
      SqliteClient.layer({
        filename,
        transformResultNames: String.snakeToCamel,
        transformQueryNames: String.camelToSnake,
      }),
    ),
  );
