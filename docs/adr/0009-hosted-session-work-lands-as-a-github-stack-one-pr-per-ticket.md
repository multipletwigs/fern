# A Hosted Session's work lands as a GitHub Stack, one PR per ticket, each with its own Walkthrough

In a Project on GitHub, a Hosted Session's work no longer goes to `main` by fast-forward push after each ticket. Each time a ticket merges into the Session's branch, the agent reports it through a Fern tool (ADR 0006). Fern then pushes a branch at that merge point, opens a draft PR on top of the Stack with the branch below as its base, and has the Fork write that PR's Walkthrough (ADR 0003) from the diff between the two merge points. The PR's description is the Walkthrough. Fixes for Rejections and the accepted Retro Findings each go on top as PRs of their own. Once every Walkthrough in the Stack is Reviewed, a Land Checkpoint marks the PRs ready and squash-merges the whole Stack with `gh stack merge`, which closes the tickets. Fern never bypasses branch protection, so when GitHub refuses the merge, the Checkpoint stays open with the reason.

## Considered Options

- **Keep pushing to `main` and only present the Walkthrough as a stack**: this needs no GitHub calls. Rejected because the review in Fern would gate nothing, and anyone who doesn't use Fern would get no guided read.
- **The agent runs `gh stack` itself, as the Setup's docs describe**: this needs the least Fern code. Rejected because Fern couldn't guarantee a Walkthrough per PR or a single landing path.
- **Fern infers tickets from the branch's merge commits**: this needs no tool. Rejected as fragile whenever a merge message doesn't name its ticket.
- **Committing a Rejection's fix into the rejected PR and merging it forward**: the Stack would read more cleanly. Rejected because it changes every PR above, and with them Walkthroughs the developer has already Reviewed.

## Consequences

- Cutting the Stack at the Session branch's first-parent merge points rewrites no history. `/implement-spec` stays unchanged, and parallel tickets still merge as they finish.
- Implement is done once every ticket has its PR in the Stack, not once every ticket is closed. A closed ticket now means its work is on `main`.
- A Session is Archived once its Stack lands. Fern detects this from the Stack's state, because a squash merge leaves the branch out of `main`'s ancestry. This amends ADR 0005.
- A Session with no tickets gets a Stack of one PR, whose Walkthroughs each cover what changed since the previous one, as before. A PR can only carry commits, so these Walkthroughs cover what's committed on the Session's branch rather than a snapshot of the working tree, and the PR can't land while the worktree has uncommitted changes.
- Every head a PR gets after it goes up, from the agent's fix for a refused Land or from a one-PR Session's next turn, gets a Walkthrough of what changed, so nothing reaches the default branch unreviewed. A PR's description covers all its Walkthroughs, oldest first.
- Projects without a GitHub remote or a signed-in `gh`, and Projects that opt out, land as before.
