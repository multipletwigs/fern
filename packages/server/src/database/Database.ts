import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Effect, Layer, String } from "effect";
import { SqlClient } from "effect/sql";

// Fern's records in one local SQLite file (ADR 0004). Migrations only run up, at startup, in id
// order; add new ones at the end and never edit one that has shipped.
export const migrations = {
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
  // The Brief and tickets a Spec Checkpoint shows, as JSON.
  "0008_checkpoint_specs": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`ALTER TABLE checkpoints ADD COLUMN spec TEXT`;
  }),
  // Findings reported with Retro, on its Checkpoint, and the developer's verdict on each.
  "0009_findings": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE findings (
        id TEXT PRIMARY KEY,
        checkpoint_id TEXT NOT NULL REFERENCES checkpoints (id),
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        change TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        verdict TEXT,
        note TEXT,
        decided_at INTEGER
      )
    `;
    yield* sql`CREATE INDEX findings_by_checkpoint ON findings (checkpoint_id)`;
  }),
  // Autonomy each Project earns at the end of Spec and of Implement: what happened at each boundary,
  // in order, from which its streak is counted, and the Milestones that offered Autonomy there.
  "0010_autonomy": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE autonomy_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        boundary TEXT NOT NULL,
        kind TEXT NOT NULL,
        session_id TEXT,
        reason TEXT,
        at INTEGER NOT NULL
      )
    `;
    yield* sql`CREATE INDEX autonomy_events_by_boundary ON autonomy_events (project, boundary)`;
    yield* sql`CREATE INDEX autonomy_events_by_session ON autonomy_events (session_id)`;
    yield* sql`
      CREATE TABLE milestones (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        boundary TEXT NOT NULL,
        status TEXT NOT NULL,
        offered_at INTEGER NOT NULL,
        decided_at INTEGER,
        withdrawn_reason TEXT
      )
    `;
    yield* sql`CREATE INDEX milestones_by_boundary ON milestones (project, boundary)`;
  }),
  // The Walkthrough an Implement Checkpoint links to. Until it's written, that Checkpoint is held.
  "0011_checkpoint_walkthroughs": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`ALTER TABLE checkpoints ADD COLUMN walkthrough_id TEXT`;
  }),
  // The size of each Session's context window, as the latest turn Fern ran on it reported. Claude
  // Code reports it only in a turn's result, so it is kept for when Fern restarts.
  "0012_context_windows": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE context_windows (
        session_id TEXT PRIMARY KEY,
        context_window INTEGER NOT NULL
      )
    `;
  }),
  // Subagent tabs the developer closed, per Session. Reopening one deletes its row.
  "0013_closed_subagents": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE closed_subagents (
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        closed_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, agent_id)
      )
    `;
  }),
  // A Hosted Session's Stack (ADR 0009): the draft PR Fern opened for each ticket that landed on
  // the Session's branch, bottom first, and the Walkthrough of each. Plus each Project's settings,
  // such as opting out of Stacks; a Project with no row has the defaults.
  "0014_stacks": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE stack_prs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        ticket INTEGER,
        title TEXT NOT NULL,
        merge_commit TEXT NOT NULL,
        branch TEXT NOT NULL,
        base TEXT NOT NULL,
        number INTEGER NOT NULL,
        url TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (session_id, position)
      )
    `;
    yield* sql`ALTER TABLE walkthroughs ADD COLUMN pr_id TEXT REFERENCES stack_prs (id)`;
    yield* sql`
      CREATE TABLE project_settings (
        project TEXT PRIMARY KEY,
        stacks INTEGER NOT NULL
      )
    `;
  }),
  // The Decisions each Section cites, as a JSON array of their ids, and its Risk. Both are NULL on
  // a Section written before Sections had them.
  "0015_section_citations_and_risk": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`ALTER TABLE walkthrough_sections ADD COLUMN decisions TEXT`;
    yield* sql`ALTER TABLE walkthrough_sections ADD COLUMN risk TEXT`;
    yield* sql`ALTER TABLE walkthrough_sections ADD COLUMN risk_reason TEXT`;
  }),
  // What each PR on a Stack carries: a ticket's work, as every PR before this did, a fix for
  // Rejections, or the accepted Findings.
  "0016_stack_pr_kinds": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`ALTER TABLE stack_prs ADD COLUMN kind TEXT NOT NULL DEFAULT 'ticket'`;
  }),
  // What each Checkpoint waits on: the end of a Phase, as every Checkpoint before this did, or
  // landing the Session's Stack, stored with phase 'retro', the Phase it follows. A Land Checkpoint
  // keeps GitHub's reason for refusing its last merge, and when that went to the agent.
  "0017_land_checkpoints": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`ALTER TABLE checkpoints ADD COLUMN kind TEXT NOT NULL DEFAULT 'phase'`;
    yield* sql`ALTER TABLE checkpoints ADD COLUMN refusal TEXT`;
    yield* sql`ALTER TABLE checkpoints ADD COLUMN refusal_sent_at INTEGER`;
  }),
  // A Walkthrough explains a Session's change or a Foreign PR's (ADR 0010): `session_id` is NULL on
  // a Foreign PR's, which names the PR instead, as GitHub's "owner/name" and its number, and keeps
  // the merge-base its change was taken from. Exactly one of the two is set, and each numbers its
  // Walkthroughs from 1. SQLite can't loosen NOT NULL in place, and the Migrator runs in one
  // transaction, where foreign keys can't be turned off, so the table is rebuilt together with the
  // two that reference it, every column named, and the copies renamed into place.
  "0018_foreign_pr_walkthroughs": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE walkthroughs_new (
        id TEXT PRIMARY KEY,
        session_id TEXT,
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
        pr_id TEXT REFERENCES stack_prs (id),
        pr_repo TEXT,
        pr_number INTEGER,
        merge_base TEXT,
        UNIQUE (session_id, number),
        UNIQUE (pr_repo, pr_number, number),
        CHECK ((session_id IS NULL) <> (pr_number IS NULL)),
        CHECK ((pr_repo IS NULL) = (pr_number IS NULL))
      )
    `;
    yield* sql`
      INSERT INTO walkthroughs_new (id, session_id, repo, number, status, error, since, base_tree,
        head_commit, head_tree, overlapping, created_at, reviewed_at, redirect_sent_at,
        redirect_error, pr_id)
      SELECT id, session_id, repo, number, status, error, since, base_tree, head_commit, head_tree,
        overlapping, created_at, reviewed_at, redirect_sent_at, redirect_error, pr_id
      FROM walkthroughs
    `;
    yield* sql`
      CREATE TABLE walkthrough_sections_new (
        walkthrough_id TEXT NOT NULL REFERENCES walkthroughs_new (id),
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
        decisions TEXT,
        risk TEXT,
        risk_reason TEXT,
        PRIMARY KEY (walkthrough_id, id)
      )
    `;
    yield* sql`
      INSERT INTO walkthrough_sections_new (walkthrough_id, id, position, title, explanation,
        dropped, fixes_walkthrough_id, fixes_item_id, verdict, note, decided_at, decisions, risk,
        risk_reason)
      SELECT walkthrough_id, id, position, title, explanation, dropped, fixes_walkthrough_id,
        fixes_item_id, verdict, note, decided_at, decisions, risk, risk_reason
      FROM walkthrough_sections
    `;
    yield* sql`
      CREATE TABLE walkthrough_hunks_new (
        walkthrough_id TEXT NOT NULL REFERENCES walkthroughs_new (id),
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
    yield* sql`
      INSERT INTO walkthrough_hunks_new (walkthrough_id, id, position, path, header, lines, added,
        removed, section_id, not_from_session, verdict, note, decided_at)
      SELECT walkthrough_id, id, position, path, header, lines, added, removed, section_id,
        not_from_session, verdict, note, decided_at
      FROM walkthrough_hunks
    `;
    yield* sql`DROP TABLE walkthrough_sections`;
    yield* sql`DROP TABLE walkthrough_hunks`;
    yield* sql`DROP TABLE walkthroughs`;
    // Renaming the parent rewrites the children's references to it.
    yield* sql`ALTER TABLE walkthroughs_new RENAME TO walkthroughs`;
    yield* sql`ALTER TABLE walkthrough_sections_new RENAME TO walkthrough_sections`;
    yield* sql`ALTER TABLE walkthrough_hunks_new RENAME TO walkthrough_hunks`;
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
