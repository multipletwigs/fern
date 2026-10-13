import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { SessionInUse, SessionNotFound, TranscriptError } from "./Sessions";
import {
  CheckpointKind,
  CheckpointStatus,
  FindingVerdictKind,
  PhaseStatus,
} from "./States";
import { PullRequest } from "./Walkthroughs";

// Every Hosted Session follows the Flow: Grill, Spec, Implement, then Retro. The agent reports its
// Phase done through a tool Fern gives it; Fern then raises a Checkpoint for the developer, and
// approving it sends the next Phase's command into the Session.

export const Phase = Schema.Literals(["grill", "spec", "implement", "retro"]);
export type Phase = typeof Phase.Type;

// The Flow's Phases, in order.
export const PHASES: ReadonlyArray<Phase> = [
  "grill",
  "spec",
  "implement",
  "retro",
];

export const FlowPhase = Schema.Struct({
  phase: Phase,
  status: PhaseStatus,
  // Why the developer skipped the Phase, on a skipped one.
  reason: Schema.optional(Schema.String),
});
export type FlowPhase = typeof FlowPhase.Type;

// An issue on the Project's issue tracker.
export const Issue = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
});
export type Issue = typeof Issue.Type;

// What Spec produced: the Brief and the tickets that implement it, as found on the issue tracker.
export const SpecIssues = Schema.Struct({
  brief: Issue,
  tickets: Schema.Array(Issue),
});
export type SpecIssues = typeof SpecIssues.Type;

// The Session's Walkthrough an Implement Checkpoint links to.
export const CheckpointWalkthrough = Schema.Struct({
  id: Schema.String,
  // 1 for the Session's first Walkthrough.
  number: Schema.Int,
});
export type CheckpointWalkthrough = typeof CheckpointWalkthrough.Type;
// The developer's call on a Finding. Declining may carry a note.
export const FindingVerdict = Schema.Struct({
  kind: FindingVerdictKind,
  note: Schema.optional(Schema.String),
});
export type FindingVerdict = typeof FindingVerdict.Type;

// A proposed change to the Setup, reported with Retro. The developer accepts or declines each one;
// the accepted ones go back to the Session to commit.
export class Finding extends Schema.Class<Finding>("Finding")({
  id: Schema.String,
  title: Schema.String,
  // The change it proposes to the Setup.
  change: Schema.String,
  // Why the Retro proposes it.
  reasoning: Schema.String,
  verdict: Schema.optional(FindingVerdict),
}) {}

// What a Session's Stack still waits on before it can Land: a PR's Walkthrough not yet written or
// Reviewed, a Rejection with no fix on the Stack, or the accepted Findings not yet up.
export const LandWait = Schema.Struct({
  // The PR it's about, when it's about one.
  pr: Schema.optional(PullRequest),
  why: Schema.String,
});
export type LandWait = typeof LandWait.Type;

// What a Land Checkpoint lands: the Session's Stack, and how the last try to merge it went.
export const Land = Schema.Struct({
  // Bottom first.
  prs: Schema.Array(PullRequest),
  // Where the developer sees the Stack on GitHub.
  url: Schema.String,
  // Fern is marking the PRs ready and merging the Stack right now.
  landing: Schema.Boolean,
  // Why GitHub refused the last try, in plain words.
  refusal: Schema.optional(Schema.String),
  // When that reason went to the Session's agent.
  refusalSentAt: Schema.optional(Schema.DateTimeUtcFromMillis),
  // What the Stack waits on again since the Checkpoint opened, such as a new fix PR's Walkthrough.
  // Nothing can land until it's empty.
  waiting: Schema.Array(LandWait),
});
export type Land = typeof Land.Type;

// A Session waiting on the developer: at the end of a Phase, where approving it moves the Flow on
// to the next Phase, or, at the end of Retro, finishes it; or with its Stack ready to Land, where
// approving it merges the Stack into `main`.
export class Checkpoint extends Schema.Class<Checkpoint>("Checkpoint")({
  id: Schema.String,
  sessionId: Schema.String,
  kind: CheckpointKind,
  // The Phase the agent reported done; for Land, Retro, the Phase it follows.
  phase: Phase,
  // What the agent says it did in the Phase.
  summary: Schema.String,
  // At the end of Spec, the Brief and its tickets the developer approves.
  spec: Schema.optional(SpecIssues),
  // At the end of Implement, the Session's Walkthrough, written before the Checkpoint is raised.
  walkthrough: Schema.optional(CheckpointWalkthrough),
  status: CheckpointStatus,
  // The developer's note on a declined Checkpoint, sent back to the Session as a Redirect.
  note: Schema.optional(Schema.String),
  // The Findings reported with Retro, in order. A Checkpoint with Findings is settled by a verdict
  // on each, never by approving it, and never by Autonomy.
  findings: Schema.optional(Schema.Array(Finding)),
  // On a Land Checkpoint, the Stack it lands.
  land: Schema.optional(Land),
  raisedAt: Schema.DateTimeUtcFromMillis,
  decidedAt: Schema.optional(Schema.DateTimeUtcFromMillis),
}) {}

// Where a Hosted Session stands in its Flow.
export class Flow extends Schema.Class<Flow>("Flow")({
  sessionId: Schema.String,
  // Grill, Spec, Implement and Retro, in order.
  phases: Schema.Array(FlowPhase),
  // The Checkpoint the Session is waiting at, if any.
  checkpoint: Schema.optional(Checkpoint),
  // Once Retro is over, what the Session's Stack waits on before its Land Checkpoint opens.
  landWaitsOn: Schema.optional(Schema.Array(LandWait)),
}) {}

// A Hosted Session's current Phase, for the sidebar. None once the Flow is over.
export const SessionPhase = Schema.Struct({
  sessionId: Schema.String,
  current: Schema.optional(Phase),
});
export type SessionPhase = typeof SessionPhase.Type;

export class CheckpointNotFound extends Schema.TaggedError<CheckpointNotFound>()(
  "CheckpointNotFound",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

// The Checkpoint was approved or declined already.
export class CheckpointClosed extends Schema.TaggedError<CheckpointClosed>()(
  "CheckpointClosed",
  { id: Schema.String },
  { httpApiStatus: 409 },
) {}

// The Phase can't be skipped: it isn't the current one (already done or not yet started), or the
// agent has reported it done and the developer has a Checkpoint to decide instead.
export class PhaseNotSkippable extends Schema.TaggedError<PhaseNotSkippable>()(
  "PhaseNotSkippable",
  {
    session: Schema.String,
    phase: Phase,
    why: Schema.Literals(["notCurrent", "checkpointPending"]),
  },
  { httpApiStatus: 409 },
) {}

// A one-line reason for a Skip: not blank.
export const SkipReason = Schema.Trim.check(Schema.isNonEmpty());

export class FindingNotFound extends Schema.TaggedError<FindingNotFound>()(
  "FindingNotFound",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

// The Checkpoint's Findings settle it: each needs a verdict instead.
export class FindingsUndecided extends Schema.TaggedError<FindingsUndecided>()(
  "FindingsUndecided",
  { id: Schema.String },
  { httpApiStatus: 409 },
) {}

// The Checkpoint doesn't take that action: a Land Checkpoint is never declined, and only a Land
// Checkpoint whose merge GitHub refused goes to the agent.
export class CheckpointActionUnavailable extends Schema.TaggedError<CheckpointActionUnavailable>()(
  "CheckpointActionUnavailable",
  { id: Schema.String },
  { httpApiStatus: 409 },
) {}

// The Stack can't Land yet: it waits on the developer's review again, or Fern is landing it already.
export class LandNotReady extends Schema.TaggedError<LandNotReady>()(
  "LandNotReady",
  { id: Schema.String },
  { httpApiStatus: 409 },
) {}

// The Session is Archived: its worktree is gone, so its Flow can't move on.
export class SessionArchived extends Schema.TaggedError<SessionArchived>()(
  "SessionArchived",
  { id: Schema.String },
  { httpApiStatus: 409 },
) {}

const SendErrors = [
  SessionNotFound,
  SessionArchived,
  SessionInUse,
  TranscriptError,
];

export class FlowsApi extends HttpApiGroup.make("flows")
  .add(
    // Marks the Phase done, makes the next one current and sends its command into the Session. On
    // a Land Checkpoint, starts marking the PRs ready and merging the Stack, which the Checkpoint
    // shows; again after GitHub refused, to try again.
    HttpApiEndpoint.post("approve", "/checkpoints/:id/approve", {
      params: { id: Schema.NonEmptyString },
      success: HttpApiSchema.NoContent,
      error: [
        CheckpointNotFound,
        CheckpointClosed,
        FindingsUndecided,
        LandNotReady,
        ...SendErrors,
      ],
    }),
  )
  .add(
    // Sends the developer's note to the Session as a Redirect. The Phase stays current.
    HttpApiEndpoint.post("decline", "/checkpoints/:id/decline", {
      params: { id: Schema.NonEmptyString },
      payload: Schema.Struct({ note: Schema.NonEmptyString }),
      success: HttpApiSchema.NoContent,
      error: [
        CheckpointNotFound,
        CheckpointClosed,
        CheckpointActionUnavailable,
        ...SendErrors,
      ],
    }),
  )
  .add(
    // Sends GitHub's reason for refusing a Land Checkpoint's merge to the Session, for the agent to
    // fix. The Checkpoint stays open.
    HttpApiEndpoint.post("send", "/checkpoints/:id/send", {
      params: { id: Schema.NonEmptyString },
      success: HttpApiSchema.NoContent,
      error: [
        CheckpointNotFound,
        CheckpointClosed,
        CheckpointActionUnavailable,
        ...SendErrors,
      ],
    }),
  )
  .add(
    // Skips the Session's current Phase with the developer's reason, makes the next one current
    // and sends its command into the Session.
    HttpApiEndpoint.post("skip", "/sessions/:session/skip", {
      params: { session: Schema.NonEmptyString },
      payload: Schema.Struct({ phase: Phase, reason: SkipReason }),
      success: HttpApiSchema.NoContent,
      error: [PhaseNotSkippable, ...SendErrors],
    }),
  )
  .add(
    // Accepts or declines a Finding. The last verdict marks Retro done and sends the accepted
    // Findings to the Session in one message.
    HttpApiEndpoint.put("findingVerdict", "/findings/:id/verdict", {
      params: { id: Schema.NonEmptyString },
      payload: FindingVerdict,
      success: HttpApiSchema.NoContent,
      error: [FindingNotFound, CheckpointClosed, ...SendErrors],
    }),
  )
  .prefix("/flows") {}
