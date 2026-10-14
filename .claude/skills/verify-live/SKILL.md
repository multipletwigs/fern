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

   This starts API `743N` and page `518N` with a fresh userData and its own `CLAUDE_CONFIG_DIR`, all under `~/.fern/verify/N`. It clones your worktree to `~/.fern/verify/N/repo` and seeds the config dir with the fixture from `scripts/verify/fixture.ts`, whose Session runs in that clone. It prints the page URL and the log folder, and fails if the slot's ports are taken.

   It also writes the slot's manifest, `~/.fern/verify/N/slot.json`: the slot, your worktree's root, its branch, both ports, the page URL, the pids it started and when. Every Fern, the developer's own and yours, reads these manifests and lists each slot with a live process under "Running" at the bottom of the sidebar, with the Session whose worktree it runs from.

   Add flags for what the change needs:

   - `--gh-shim [fixture]` for the Pull requests page, Walk through, Try it and posting reviews. It puts a fake `gh` first on the slot's PATH, serving the PRs and Stacks of `scripts/verify/gh-shim/fixture.json` (or the fixture you name), and the clone fetches and pushes from a bare repo in the slot folder. Nothing reaches GitHub: every write, such as a posted review, goes on a line of `~/.fern/verify/N/gh-writes.jsonl`. Without it, the slot runs your real `gh` on the real repo, and a review posted there goes up on GitHub.
   - `--claude-auth` to run Turns, Forks and Walkthroughs end to end. The slot's Claude Code uses your own login from the keychain, so it spends real tokens: use it only when the check needs Claude to answer.

2. Drive it with agent-browser, in the slot's own browser session:

   ```sh
   export AGENT_BROWSER_SESSION=fern-verify-N
   agent-browser open http://localhost:518N && agent-browser wait 2500
   agent-browser snapshot -i -c          # find refs; the fixture Session starts "Fixture: audit…"
   agent-browser click @eX
   agent-browser screenshot ~/.fern/verify/N/shot.png
   ```

   The chat is a virtual list, so only rows on screen show in a snapshot. Scroll (`agent-browser scroll down 3000`) to reach later rows.

3. After a change to the main process, the server or the API, restart: `pnpm verify:down N`, then `pnpm verify:up N` again with the same flags (it rebuilds). Web changes hot-reload through Vite.

4. Finish with `pnpm verify:down N`. It stops only that slot's processes, removes its manifest, deletes the clone and closes its browser session. The rest of the slot's folder stays until the next `pnpm verify:up N` clears it, so move screenshots you want to keep elsewhere.

## The clone

The fixture Session's cwd, and so the slot's Project, is `~/.fern/verify/N/repo`: a clone of your worktree at its last commit, with your worktree's `origin`, so Fern still finds the repo on GitHub. The PR refs (`refs/fern/…`) and worktrees the slot makes go into the clone's `.git`, never your shared one. Work you haven't committed isn't in it: commit first to see it in the code panel or a Session.

Under `--gh-shim`, the clone's `origin` reads `git@github.com:owner/name.git` and its `core.sshCommand` answers from `~/.fern/verify/N/remote.git`, which holds each fixture PR's branch and `refs/pull/N/head`.

## The fixture

One External Session (`f2121212-…`) whose cwd is the clone. It has:

- a background Subagent that starts a nested one (spawnDepth 2);
- two back-to-back foreground Explore Subagents, one handing back through `SubagentHandback` and one with plain text;
- three finished background Subagents, enough to fill the Agents menu;
- one Subagent still running, which ends on a tool call with no result;
- at the end, the developer's turns: a slash command, a message with an image, and an unanswered message with its Resend notice.

Add a case by extending `writeFixture`.

The gh shim's fixture lists the signed-in `login`, the Stacks, the issues and the PRs, each with the `edits` that `verify:up` commits on top of its base, in the shape `scripts/verify/gh-shim/shape.ts` gives. The shim fails loudly on any `gh` call it has no answer for: add one to `scripts/verify/gh-shim/gh.ts` when Fern starts making it.

## Pitfalls

- Without `--claude-auth`, Claude Code in the slot is signed out: sending a message, starting a New Session or writing a Walkthrough fails on its login. Their worktrees and refs go into the clone either way.
- The Try it Terminal's shell reads your rc files, which may put the real `gh` back ahead of the shim. Fern's own `gh` calls, and Claude Code's, use the shim.
- Freshly written fixture files read as live ("Running in a terminal") for a few minutes, because their mtimes are new.
- Fern hides Sessions whose lines say `"entrypoint":"sdk-ts"`. When copying a real transcript into the fixture config, rewrite those lines to `"cli"`.
- Agent ids take Claude Code's shape, `a` and 16 hex digits; the SDK rejects others.
- The code panel shows the clone's git changes, read-only: none until a Session makes some.
