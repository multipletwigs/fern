---
name: verify-live
description: Run an isolated Fern from the current worktree and drive it with agent-browser. Use to check a UI or server change live in the running app, especially inside a Hosted Session, where the developer's own Fern is serving this conversation.
---

# Verify live in an isolated Fern

The developer's own Fern (API on 7420, page on 5173, its own userData and `~/.claude`) hosts the Session you're running in. Leave it running and untouched: check your change in an isolated Fern of your own.

## Steps

1. Pick a slot N from 1 to 9; each parallel agent takes a different one. Start it from your worktree's root:

   ```sh
   pnpm verify:up N
   ```

   This starts API `743N` and page `518N` with a fresh userData and its own `CLAUDE_CONFIG_DIR`, all under `~/.fern/verify/N`. It seeds that config dir with the fixture from `scripts/verify/fixture.ts`. It prints the page URL and the log folder, and fails if the slot's ports are taken.

   It also writes the slot's manifest, `~/.fern/verify/N/slot.json`: the slot, your worktree's root, its branch, both ports, the page URL, the pids it started and when. Every Fern, the developer's own and yours, reads these manifests and lists each slot with a live process under "Running" at the bottom of the sidebar, with the Session whose worktree it runs from.

2. Drive it with agent-browser, in the slot's own browser session:

   ```sh
   export AGENT_BROWSER_SESSION=fern-verify-N
   agent-browser open http://localhost:518N && agent-browser wait 2500
   agent-browser snapshot -i -c          # find refs; the fixture Session starts "Fixture: audit…"
   agent-browser click @eX
   agent-browser screenshot ~/.fern/verify/N/shot.png
   ```

   The chat is a virtual list, so only rows on screen show in a snapshot. Scroll (`agent-browser scroll down 3000`) to reach later rows.

3. After a change to the main process, the server or the API, restart: `pnpm verify:down N`, then `pnpm verify:up N` again (it rebuilds). Web changes hot-reload through Vite.

4. Finish with `pnpm verify:down N`. It stops only that slot's processes, removes its manifest and closes its browser session. The rest of the slot's folder stays until the next `pnpm verify:up N` clears it, so move screenshots you want to keep elsewhere.

## The fixture

One External Session (`f2121212-…`) whose cwd is your worktree. It has:

- a background Subagent that starts a nested one (spawnDepth 2);
- two back-to-back foreground Explore Subagents, one handing back through `SubagentHandback` and one with plain text;
- three finished background Subagents, enough to overflow the tab bar into "+N";
- one Subagent still running, which ends on a tool call with no result.

Add a case by extending `writeFixture`.

## Pitfalls

- Browse and read only. Sending a message, starting a New Session or archiving spawns Claude Code with the fixture's empty credentials, and creates git worktrees off the real repo.
- Freshly written fixture files read as live ("Running in a terminal") for a few minutes, because their mtimes are new.
- Fern hides Sessions whose lines say `"entrypoint":"sdk-ts"`. When copying a real transcript into the fixture config, rewrite those lines to `"cli"`.
- Agent ids take Claude Code's shape, `a` and 16 hex digits; the SDK rejects others.
- The code panel shows your worktree's real git changes, read-only.
