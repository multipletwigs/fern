# Second-opinion security review

Run this alongside `/code-review` when a diff touches `apps/desktop`, `packages/server/src/live.ts`, `origin.ts` or `routes.ts`, `terminal/`, or anything that spawns a process. On Brief #30 it found five issues `/code-review` missed.

## Steps

1. List what's already fixed or knowingly deferred in this diff (ADR 0008's Consequences, open issues) so the reviewers don't re-report it.
2. Start three reviews in parallel, one per attack surface, each with the same opening, then its own focus:

   ```sh
   pi -p --no-session --model "nous/deepseek/deepseek-v4.1-flash:US" --tools read,bash \
     "Read-only security review of <range>. Don't modify files, install or use the network. \
      At most ~25 tool calls, then write the report. Start with git diff --stat, then read \
      diffs file by file. For each finding: file:line, severity, concrete exploit, fix. \
      Skip anything you can't back with code. Already fixed or deferred: <list>. \
      Focus ONLY on: <surface>" > ~/.fern/reviews/<brief>-<surface>.md
   ```

   The three surfaces:
   - **Electron window:** webPreferences, navigation and new-window handling, `shell.openExternal`, permissions, and where the server listens.
   - **Origin guard and spawning endpoints:** bypasses of `OriginGuard`, and every endpoint that spawns a process or writes a file from request input.
   - **PTY and tools:** the environment given to the shell and to spawned tools, Session id checks on every terminal RPC, buffers, viewer counts and input sizes.

   Each one gets its own background run with a timeout of 30 minutes or more. Print mode writes nothing until the very end, so a run cut off by its timeout leaves an empty report.
3. Check every finding against the code before acting on it. The model can be wrong, and its severities run high.

Done when each verified finding is fixed or recorded as deferred (in an issue, or in ADR 0008's Consequences), and each rejected one has a one-line reason in the fix's commit or the Session.

## Gotchas

- `deepseek-v4.1-flash:US` has a 131K context: one prompt covering a whole branch's diff runs out of room and comes back empty. Keep the reviews scoped. `deepseek-v4-flash` (1M) is for unavoidably large inputs.
- pi's default model is something else, so always pass `--model`. A model asked its own name can answer wrong; `--mode json` shows the model actually called.
- Inside a subagent's worktree (`.claude/worktrees/…`) the sandbox refuses `pi`. There, run each surface's review as a read-only Claude subagent (Explore) with the same prompt instead, and say so in the fix's commit.
