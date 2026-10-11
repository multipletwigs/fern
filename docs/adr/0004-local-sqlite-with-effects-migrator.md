# Fern's records live in one local SQLite database, migrated by Effect's Migrator

Walkthroughs, approvals, Decisions, and Briefs are stored in a single `fern.db` in Electron's userData directory and keyed by Project (its git root path). Nothing is written to the repo. The database is accessed through `@effect/sql-sqlite-node`, which runs on the built-in `node:sqlite` (Electron 44 ships Node 24), so no native module has to be rebuilt for Electron. Migrations use Effect's own `effect/sql/Migrator` and only run up, applied at app start. We accept that this API is marked unstable so that the whole stack stays on Effect.

## Considered Options

- **A `.fern/` file committed to the repo**: it would travel with the PR, but it adds noise to the repo. Exporting to a PR body or to Linear or Notion can be added later on top of SQLite.
- **Umzug, or Kysely/knex migrators, for down migrations**: down migrations aren't needed yet, and these tools bring a second migration or query layer next to Effect's `SqlClient`.
- **dbmate**: every user's install would have to ship a Go binary to migrate at startup.
- **better-sqlite3**: a native module that has to be rebuilt against Electron's ABI.

## Consequences

- Moving a repo orphans its history until it is relinked.
- What happens when an older Fern opens a database written by a newer one is not decided yet.
