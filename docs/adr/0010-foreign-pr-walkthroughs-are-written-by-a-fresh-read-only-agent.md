# A Foreign PR's Walkthrough is written by a fresh read-only agent, not a Fork

A Foreign PR has no Session behind it, so ADR 0003's Fork has no transcript to resume. When the developer asks for a Walkthrough of one, Fern instead starts a new agent conversation in a detached worktree checked out at the PR's head. That agent gets the PR's title, body, and linked issue, plus the Project's Decisions, and it can only use read-only tools. It writes the same Sections, Risks and hunk claims, and ADR 0003's git coverage check holds it to account the same way: one retry, then Unexplained changes. The agent is not a Session, so it never affects Redirects or the Trust score.

## Considered Options

- **Diff only, no tools**: this is cheapest. Rejected because without the author's intent, the agent has to read the surrounding code to explain why a hunk matters.
- **A Hosted Session on the PR**: this reuses everything. Rejected because the work isn't the developer's going through the Flow, and counting it would skew the Trust score.

## Consequences

- A Foreign PR's Sections are never Unplanned: they cite a Decision only when one genuinely applies.
- Verdicts stay in Fern. A Rejection reaches the author only when the developer posts a GitHub review, which is never automatic.
- A Walkthrough is written only when the developer asks for one. A later Walkthrough covers the old head to the new one, but it falls back to the whole PR when the head was force-pushed or the PR's base moved.
- A PR in a Hosted Session's Stack is never treated as a Foreign PR. Opening it leads to that Session's Review tab and its Fork-written Walkthroughs.
