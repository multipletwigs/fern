# One Hosted Session is one worktree and carries its work through the whole Flow

Starting a Hosted Session creates a branch from the tip of `main` and a git worktree outside the repo, and runs Claude Code inside it. That one Session takes the work through Grill, Spec, Implement, and Retro. Implement runs `/implement-spec`, which builds every ticket onto the Session's own branch as the integration branch, with its implementer subagents in worktrees branched off it. One Session for the whole Flow keeps the Grill, the Brief, and the tickets in one context, and gives the developer one sidebar row, one branch, and one checklist per piece of work.

## Considered Options

- **One Session per ticket** (`/implement` with a cleared context for each): this is the skills' default for multi-session builds. Rejected because the idea-to-ship path would be spread across Sessions, so no single Session could show the whole Flow, and Trust scores would be measured on fragments.
- **Sessions in the main checkout**: no worktree setup is needed, but parallel Sessions would overwrite each other's changes, and a Walkthrough's snapshot diff could not tell them apart (ADR 0003).

## Consequences

- Implement can need a lot of context in one Session. `/implement-spec` keeps it manageable by handing each ticket to a subagent and passing context pointers rather than file contents.
- Fern removes a Session's worktree when its branch merges or the Session is archived. If there are uncommitted changes, it asks first.
- Accepted Retro Findings are committed on the Session's branch, separate from the feature code. The Setup version moves forward when that branch merges.
