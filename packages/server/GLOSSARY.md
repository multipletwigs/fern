# Server

The domain behind Fern's API: how a developer's agent setup verifies its own work, and how Fern measures whether that setup is earning trust.

## Language

### Verification

**Self-verification loop**:
The cycle in which a coding agent changes code, runs Checks against its own change, and presents Evidence before handing back to the developer.
_Avoid_: Feedback loop, review loop

**Check**:
A developer-approved, runnable test of the agent's work (test suite, typecheck, screenshot diff, scripted app run).
_Avoid_: Validation, gate, guard

**Evidence**:
The record a Check produces about a specific change, which the developer reviews instead of the raw diff.
_Avoid_: Proof, artifact, report

**Diagnosis**:
The cause assigned to a failed Check: a Defect, a Bad invariant, or a Flake. The agent proposes it; the developer confirms it.
_Avoid_: Root cause, triage label

**Defect**:
A Diagnosis meaning the code is wrong and the Check was right.
_Avoid_: Bug (too loose), regression

**Bad invariant**:
A Diagnosis meaning the Check enforces something wrong or outdated, so the Check must change.
_Avoid_: False positive, wrong test

**Flake**:
A Diagnosis meaning the failure came from the environment or nondeterminism, not from the code or the Check.
_Avoid_: Intermittent, noise

### Measurement

**Setup**:
Everything that shapes an agent in one repo (steering files, skills, hooks, Checks), versioned as a whole. The Setup is the unit Fern benchmarks.
_Avoid_: Config, environment, harness

**Session**:
One Claude Code conversation, attributed to the Setup version it ran under.
_Avoid_: Chat, thread, run

**Redirect**:
A developer message mid-Session that corrects the agent's course. Opening tasks, approvals, and "continue" are not Redirects.
_Avoid_: Correction, steer, intervention

**Escape**:
A Redirect that follows the agent claiming done with passing Checks; evidence that a Check is too loose. An Escape withdraws any Autonomy earned at the Phase boundaries it slipped past.
_Avoid_: Miss, false pass

**Trust score**:
A single quantified measure of how far a Setup can be relied on without Redirects, normalized against the developer's own Sessions rather than a fixed scale. A higher Trust score earns more Autonomy.
_Avoid_: Confidence, health

**Autonomy**:
The set of Checkpoints Fern resolves on the developer's behalf, earned through the Trust score, so the developer's attention is spent only where it is needed. Ending a Grill and accepting Findings are never part of it.
_Avoid_: Auto mode (Claude Code's permission mode), autopilot, self-driving

**Milestone**:
A recognised point in a Setup's track record, often carrying an offer of more Autonomy that the developer accepts or declines.
_Avoid_: Gem, badge, achievement, streak

**Hosted Session**:
A Session Fern drives itself, in its own git worktree (in place, for a folder outside git or a repo with no commits yet), so its Redirects, Checkpoints, and Phases are recorded exactly. Each Hosted Session carries one piece of work through the whole Flow.
_Avoid_: Fern session, managed session

**Archived**:
Said of a Hosted Session whose worktree Fern has removed, because the developer archived it, its Stack Landed, or its branch merged into `main`. The sidebar no longer lists it; its branch is kept. Uncommitted changes are only thrown away when the developer confirms.
_Avoid_: Closed, deleted

**Subagent**:
A conversation that Claude Code delegates to through its Agent tool, shown inside its Session and never counted as a Session of its own.
_Avoid_: Worker (the Verifier's term), child session, task

**Assignment**:
The prompt a Session's agent gives a Subagent when it delegates to it.
_Avoid_: Prompt (the developer's message), brief, task

**Hand-back**:
A Subagent's final answer to the agent that delegated to it, whether it comes back at once or arrives later from the background.
_Avoid_: Report (the Verifier's term), result

**Fork**:
A conversation Fern branches off a Session for its own purposes, such as writing a Walkthrough. Like a Subagent, it is never counted as a Session.
_Avoid_: Branch (git), clone, side session

**External Session**:
A Session the developer ran outside Fern, observed after the fact and benchmarked less precisely.
_Avoid_: Terminal session, imported session

**Retro**:
A review of one or more Sessions that yields Findings about the Setup.
_Avoid_: Retrospective, postmortem

**Finding**:
A proposed change to the Setup surfaced by a Retro. Accepting a Finding is the only way the Setup version changes.
_Avoid_: Suggestion, improvement, action item

### Review

**Walkthrough**:
The developer-facing explanation of one change a Session made, usually one PR of its Stack: Sections in dependency order (contract before service before API before UI), in natural language, that together account for every changed line of the net change. The developer reviews a Walkthrough instead of the raw diff. Fern produces one whenever a Session's work completes; it is not a Phase, so no Flow can leave it out.
_Avoid_: Diff, summary, changelog, report

**Stack**:
A Session's work as a chain of pull requests on GitHub, one per ticket in the order the tickets landed on the Session's branch, each based on the one below, and the bottom one on the repo's default branch. A fix for Rejections, and the accepted Findings, each go on top as a PR of their own. Each PR carries its own Walkthroughs, which are its description too: usually one, and another for each change to the PR after a refused Land, or, on a Session's one PR, for each of its turns.
_Avoid_: PR chain, series, train

**Land**:
To merge a Session's Stack into the repo's default branch (`main`, usually), all at once, through a Checkpoint that opens once every Walkthrough in the Stack is Reviewed with no Rejection left open.
_Avoid_: Ship, deploy, merge (for the whole Stack)

**Section**:
One semantic change within a Walkthrough, explained in prose and claiming the hunks that implement it, across as many files as it touches. It cites the Decisions behind it, carries a Risk, and notes in one line any approach tried and dropped on the way. The developer approves or rejects each Section on its own.
_Avoid_: Step (Phase avoids it), chunk, file group

**Risk**:
How closely the developer should read a Section, low, medium or high, with a one-line reason. The Fork sets it; it guides attention and never blocks a verdict.
_Avoid_: Severity, priority, confidence

**Round**:
A batch of questions the agent puts to the developer at once during Grill, each with the agent's recommended answer.
_Avoid_: Questionnaire, form, survey

**Decision**:
A question settled with the developer, usually an answered question from a Round, recorded so later Sections can cite it. A Decision belongs to the Project, so a Section can cite one settled in an earlier Session.
_Avoid_: Answer, choice, requirement

**Brief**:
The outcomes a Session is meant to deliver, each citing the Decisions behind it, written in the Spec Phase together with the tickets that implement it. The developer approves it before Implement begins, and Fern judges that a Session's work is complete against it.
_Avoid_: Plan (Claude Code's plan mode), ticket, spec, task list

**Reviewed**:
Said of a Walkthrough once the developer has approved or rejected every Section. Sections cannot be skipped.
_Avoid_: Done, signed off

**Unplanned**:
Said of a Section that cites no Decision: the agent changed something the developer never agreed to.
_Avoid_: Scope creep, extra

**Unexplained change**:
A changed hunk that no Section claims. A Walkthrough shows every Unexplained change, and the developer cannot skip them.
_Avoid_: Orphan, leftover

**Rejection**:
The developer turning down a Section, with a note. The note goes back to the Session as a Redirect, and the reason becomes material for a Retro.
_Avoid_: Decline, revert

### Workflow

**Flow**:
The ordered Phases every Hosted Session follows: Grill, Spec, Implement, then Retro. It is versioned as part of the Setup.
_Avoid_: Pipeline, workflow, process

**Phase**:
A named stage of a Flow: Grill, Spec, Implement, or Retro. The agent decides when its Phase is done, and moving to the next Phase is a Checkpoint unless Autonomy covers it.
_Avoid_: Step, stage, mode

**Skip**:
A Phase passed over with a one-line reason from the developer, shown on the Flow and kept in the Session's record.
_Avoid_: Bypass, override

**Verifier**:
A Check that hands verification to a separate Worker agent and returns only a fixed-format Report, guarded by a Preflight and hard Stops.
_Avoid_: Pipeline, verification agent, QA bot

**Pipeline**:
Reserved for CI runs on the code host; never a Fern concept.

**Timebox**:
An optional duration on a Phase; overrunning it raises a Checkpoint, never stops the agent.
_Avoid_: Timeout, deadline, budget

**Preview**:
The developer's app running from one Session's worktree, frontend and backend both, shown in Fern beside that Session.
_Avoid_: Dev server, browser tab, sandbox

**Verify slot**:
An isolated Fern an agent starts from its worktree with `pnpm verify:up`, to check its change to Fern in the running app: its own ports, data and Claude config, recorded in a manifest so every Fern lists it as running. Unlike a Preview, it runs Fern itself, and exists only for work on Fern.
_Avoid_: Sandbox, instance

**Terminal**:
A Session's own login shell, running in the Session's folder, shown in a panel under its screen. It outlives its viewers: switching away or reloading the page detaches, and coming back replays what it printed. It ends when the developer restarts it, the Session is archived, or Fern quits.
_Avoid_: Console, shell panel

**Tool check**:
Fern's check, shown in Settings, that the tools it runs on are ready: `claude`, `gh` and `git` installed, `gh` signed in, and the `gh-stack` extension installed. Only `gh-stack` is optional: without it, work lands without a Stack.
_Avoid_: Prerequisite, doctor, health check

**Checkpoint**:
A point where a Session is waiting on the developer's decision. Checkpoints from all Sessions share one queue.
_Avoid_: Prompt, approval, interrupt, blocker
