import { Schema } from "effect";

// Every state in Fern: where a thing stands, as a set of names. Each is declared once here, as a
// schema with its type, and imported everywhere else: the contract, the server, its storage, and
// the UI. Don't write a string-literal union of a state anywhere else; `pnpm lint` flags one.

// Subagents and tool calls

// Where a Subagent stands: still working, handed back, ended in an error, or ended without a
// Hand-back, such as when it was cut off.
export const SubagentStatus = Schema.Literals([
  "running",
  "done",
  "failed",
  "stopped",
]);
export type SubagentStatus = typeof SubagentStatus.Type;

// Where a tool call stands: running until its result arrives, then done or failed. Unlike a
// Subagent, a tool call is never stopped short of a result.
export const ToolCallStatus = SubagentStatus.pick([
  "running",
  "done",
  "failed",
]);
export type ToolCallStatus = typeof ToolCallStatus.Type;

// Turns

// What one message from Claude Code did to a Session's turn: nothing, as no turn runs and it starts
// none; the turn goes on; or the turn is over, finished for the developer or ended without them.
export const TurnOutcome = Schema.Literals([
  "idle",
  "running",
  "finished",
  "ended",
]);
export type TurnOutcome = typeof TurnOutcome.Type;

// Sending a developer's message that Claude Code didn't answer again: not yet, under way, sent, or
// failed.
export const ResendState = Schema.Literals([
  "idle",
  "sending",
  "sent",
  "failed",
]);
export type ResendState = typeof ResendState.Type;

// The Flow

// Where a Phase stands in a Session's Flow.
export const PhaseStatus = Schema.Literals([
  "notStarted",
  "current",
  "done",
  "skipped",
]);
export type PhaseStatus = typeof PhaseStatus.Type;

// Where a Checkpoint stands: waiting on the developer, or decided.
export const CheckpointStatus = Schema.Literals([
  "pending",
  "approved",
  "declined",
]);
export type CheckpointStatus = typeof CheckpointStatus.Type;

// What a Checkpoint waits on the developer for: the end of a Phase, or landing the Session's Stack
// on `main` once Retro is over.
export const CheckpointKind = Schema.Literals(["phase", "land"]);
export type CheckpointKind = typeof CheckpointKind.Type;

// A Checkpoint as the server stores it: also `held`, not yet shown, at the end of Implement until
// the Session's Walkthrough is written.
export const StoredCheckpointStatus = Schema.Literals([
  ...CheckpointStatus.literals,
  "held",
]);
export type StoredCheckpointStatus = typeof StoredCheckpointStatus.Type;

// The developer's call on a Retro Finding.
export const FindingVerdictKind = Schema.Literals(["accepted", "declined"]);
export type FindingVerdictKind = typeof FindingVerdictKind.Type;

// Autonomy

// Where a Milestone stands: offered, decided by the developer, or withdrawn by an Escape.
export const MilestoneStatus = Schema.Literals([
  "offered",
  "accepted",
  "declined",
  "withdrawn",
]);
export type MilestoneStatus = typeof MilestoneStatus.Type;

// What the developer can decide a Milestone to be.
export const MilestoneDecision = MilestoneStatus.pick(["accepted", "declined"]);
export type MilestoneDecision = typeof MilestoneDecision.Type;

// What happened at an earnable boundary, as the server records it. A `declined` Checkpoint, a
// `reset` (a Milestone decided) or Autonomy `withdrawn` starts the streak over; `clean` passes
// count towards it; `approved` is a pass after a declined Checkpoint, and `fern` one Fern approved
// itself, which count for nothing.
export const AutonomyEventKind = Schema.Literals([
  "clean",
  "approved",
  "declined",
  "fern",
  "reset",
  "withdrawn",
]);
export type AutonomyEventKind = typeof AutonomyEventKind.Type;

// Walkthroughs

// Where a Walkthrough stands: being written, ready for review, or failed to be written.
export const WalkthroughStatus = Schema.Literals([
  "writing",
  "ready",
  "failed",
]);
export type WalkthroughStatus = typeof WalkthroughStatus.Type;

// The developer's call on a Section or an Unexplained change.
export const VerdictKind = Schema.Literals(["approved", "rejected"]);
export type VerdictKind = typeof VerdictKind.Type;

// How closely the developer should read a Section.
export const RiskLevel = Schema.Literals(["low", "medium", "high"]);
export type RiskLevel = typeof RiskLevel.Type;

// Where the controls for one verdict stand: showing the buttons or the verdict, taking a
// Rejection's note, or changing a verdict given already.
export const VerdictMode = Schema.Literals(["idle", "noting", "changing"]);
export type VerdictMode = typeof VerdictMode.Type;

// What a PR on a Session's Stack carries: a ticket's work, a fix for Rejections of the PRs below,
// the Setup change from the Retro's accepted Findings, or, for a Session without tickets, all of
// its work, as the one PR of its Stack.
export const StackPrKind = Schema.Literals([
  "ticket",
  "fix",
  "findings",
  "session",
]);
export type StackPrKind = typeof StackPrKind.Type;

// The issue tracker

// Whether an issue on the Project's issue tracker is open.
export const IssueState = Schema.Literals(["open", "closed"]);
export type IssueState = typeof IssueState.Type;

// The same, as `gh` prints it: in capitals.
export const GhIssueState = Schema.Literals(["OPEN", "CLOSED"]);
export type GhIssueState = typeof GhIssueState.Type;

// Pull requests on the Project's repo

// Whether a pull request is still open, was closed without merging, or merged.
export const PrState = Schema.Literals(["open", "closed", "merged"]);
export type PrState = typeof PrState.Type;

// The same, as `gh` prints it: in capitals.
export const GhPrState = Schema.Literals(["OPEN", "CLOSED", "MERGED"]);
export type GhPrState = typeof GhPrState.Type;

// Where a Foreign PR's latest Walkthrough stands, as the Pull requests page lists it: being written,
// failed to be written, written and waiting on the developer's verdicts, or Reviewed. A PR with no
// Walkthrough has none of these.
export const PrWalkthroughState = Schema.Literals([
  "writing",
  "failed",
  "unreviewed",
  "reviewed",
]);
export type PrWalkthroughState = typeof PrWalkthroughState.Type;

// The developer's tools

// The tools Fern runs on that the developer installs and signs in to themselves: Claude Code, the
// GitHub CLI, git, and the GitHub CLI's gh-stack extension, which puts a Hosted Session's work up
// as a Stack, in the order Settings lists them.
export const DeveloperTool = Schema.Literals([
  "claude",
  "gh",
  "git",
  "gh-stack",
]);
export type DeveloperTool = typeof DeveloperTool.Type;

// Where one of those tools stands: installed and usable; installed but not usable yet, as `gh`
// signed out; not on the PATH Fern runs with; or no answer from the check, as when it timed out.
export const DeveloperToolState = Schema.Literals([
  "ready",
  "needs-attention",
  "missing",
  "unknown",
]);
export type DeveloperToolState = typeof DeveloperToolState.Type;
