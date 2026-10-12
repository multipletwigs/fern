import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { SessionInUse, SessionNotFound, TranscriptError } from "./Sessions";

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

export const PhaseStatus = Schema.Literals([
  "notStarted",
  "current",
  "done",
  "skipped",
]);
export type PhaseStatus = typeof PhaseStatus.Type;

export const FlowPhase = Schema.Struct({
  phase: Phase,
  status: PhaseStatus,
});
export type FlowPhase = typeof FlowPhase.Type;

export const CheckpointStatus = Schema.Literals([
  "pending",
  "approved",
  "declined",
]);
export type CheckpointStatus = typeof CheckpointStatus.Type;

// The developer's call on a Finding. Declining may carry a note.
export const FindingVerdict = Schema.Struct({
  kind: Schema.Literals(["accepted", "declined"]),
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

// A Session waiting on the developer at the end of a Phase: approving it moves the Flow on to the
// next Phase, or, at the end of Retro, finishes it.
export class Checkpoint extends Schema.Class<Checkpoint>("Checkpoint")({
  id: Schema.String,
  sessionId: Schema.String,
  // The Phase the agent reported done.
  phase: Phase,
  // What the agent says it did in the Phase.
  summary: Schema.String,
  status: CheckpointStatus,
  // The developer's note on a declined Checkpoint, sent back to the Session as a Redirect.
  note: Schema.optional(Schema.String),
  // The Findings reported with Retro, in order. A Checkpoint with Findings is settled by a verdict
  // on each, never by approving it, and never by Autonomy.
  findings: Schema.optional(Schema.Array(Finding)),
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

const SendErrors = [SessionNotFound, SessionInUse, TranscriptError];

export class FlowsApi extends HttpApiGroup.make("flows")
  .add(
    // Marks the Phase done, makes the next one current and sends its command into the Session.
    HttpApiEndpoint.post("approve", "/checkpoints/:id/approve", {
      params: { id: Schema.NonEmptyString },
      success: HttpApiSchema.NoContent,
      error: [
        CheckpointNotFound,
        CheckpointClosed,
        FindingsUndecided,
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
      error: [CheckpointNotFound, CheckpointClosed, ...SendErrors],
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
