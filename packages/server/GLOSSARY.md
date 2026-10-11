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
A Redirect that follows the agent claiming done with passing Checks; evidence that a Check is too loose.
_Avoid_: Miss, false pass

**Trust score**:
A single quantified measure of how far a Setup can be relied on without Redirects, normalized against the developer's own Sessions rather than a fixed scale. A higher Trust score earns more Autonomy.
_Avoid_: Confidence, health

**Autonomy**:
The set of Checkpoints Fern resolves on the developer's behalf, earned through the Trust score, so the developer's attention is spent only where it is needed.
_Avoid_: Auto mode (Claude Code's permission mode), autopilot, self-driving

**Milestone**:
A recognised point in a Setup's track record, often carrying an offer of more Autonomy that the developer accepts or declines.
_Avoid_: Gem, badge, achievement, streak

**Hosted Session**:
A Session Fern drives itself, so its Redirects, Checkpoints, and Phases are recorded exactly.
_Avoid_: Fern session, managed session

**Subagent**:
A conversation that Claude Code delegates to through its Agent tool, shown inside its Session and never counted as a Session of its own.
_Avoid_: Worker (the Verifier's term), child session, task

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
The developer-facing explanation of what a Session changed since its previous Walkthrough (or since it started): ordered Sections, in natural language, that together account for every changed line of the net change. The developer reviews a Walkthrough instead of the raw diff. Fern produces one whenever a Session's work completes; it is not a Phase, so no Flow can leave it out.
_Avoid_: Diff, summary, changelog, report

**Section**:
One semantic change within a Walkthrough, explained in prose and claiming the hunks that implement it, across as many files as it touches. It notes in one line any approach tried and dropped on the way. The developer approves or rejects each Section on its own.
_Avoid_: Step (Phase avoids it), chunk, file group

**Decision**:
A question settled with the developer, usually during Grill, recorded so later Sections can cite it. A Decision belongs to the Project, so a Section can cite one settled in an earlier Session.
_Avoid_: Answer, choice, requirement

**Brief**:
The outcomes a Session is meant to deliver, agreed with the developer when a Grill ends, each citing the Decisions behind it. Fern judges that a Session's work is complete against its Brief.
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
The ordered Phases every Session in a repo follows, built by the developer and versioned as part of the Setup.
_Avoid_: Pipeline, workflow, process

**Phase**:
A named stage of a Flow, such as Grill, Execute, or Ship.
_Avoid_: Step, stage, mode

**Verifier**:
A Check that hands verification to a separate Worker agent and returns only a fixed-format Report, guarded by a Preflight and hard Stops.
_Avoid_: Pipeline, verification agent, QA bot

**Pipeline**:
Reserved for CI runs on the code host; never a Fern concept.

**Timebox**:
An optional duration on a Phase; overrunning it raises a Checkpoint, never stops the agent.
_Avoid_: Timeout, deadline, budget

**Checkpoint**:
A point where a Session is waiting on the developer's decision. Checkpoints from all Sessions share one queue.
_Avoid_: Prompt, approval, interrupt, blocker
