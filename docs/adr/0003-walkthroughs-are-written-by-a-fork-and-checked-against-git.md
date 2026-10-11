# Walkthroughs are written by a Fork of the Session and checked for coverage against git snapshots

When a Session's work completes, Fern forks the Session and has the Fork write the Walkthrough. The Fork already knows the intent, the Decisions, and the approaches that were tried and dropped, while the main transcript stays clean. An agent explaining its own work can leave things out, so Fern does not trust the Fork's account. Fern snapshots the working tree when the Session starts and again at the end of each Walkthrough, storing the snapshots as hidden refs under `refs/fern/` in the repo's own `.git`. These refs are never pushed and leave the history and working tree untouched. Every hunk between two snapshots must be claimed by a Section. The Fork gets one retry to claim the rest, and whatever is still unclaimed after that is shown as an Unexplained change, which the developer cannot skip.

## Considered Options

- **A fresh agent that sees only the diff and the Decisions**: it is more independent, but it has to guess the intent and the rolled-back attempts. The coverage check gives the honesty, so the Fork's context wins.
- **Change lists built from the transcript's Edit and Write calls**, which is how the code panel works today: these miss changes made through Bash and record history instead of the net change. A rollback would show up as two edits rather than nothing.
- **Snapshotting through commits**: this would tie the Walkthrough to how often the agent commits, and would rewrite the developer's history.

## Consequences

- A Walkthrough covers only the changes since the previous Walkthrough, so approvals are never invalidated. A fix for a Rejection shows up in the next Walkthrough, linked to that Rejection.
- Snapshot diffs cannot tell this Session's changes apart from another agent working in the same worktree. The Fork labels hunks that don't match its own tool calls as "Not from this Session", and Fern warns when another Hosted Session overlapped the window.
- Neither Forks nor Subagents count as Sessions, so they never affect Redirects or the Trust score.
