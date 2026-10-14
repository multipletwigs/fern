import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { MilestoneStatus } from "./States";

// Fern earns Autonomy per Project at three boundaries: the end of Spec (Spec → Implement), the end
// of Implement (Implement → Retro), and Land, where a Session's Stack merges into `main` once Retro
// is over. Each counts a streak of clean passes, approved with no declined Checkpoint; at
// AUTONOMY_THRESHOLD in a row a Milestone offers Autonomy there. Ending a Grill and accepting
// Findings (the end of Retro) are never earnable.

// An earnable boundary, named by the Phase it ends, or Land.
export const Boundary = Schema.Literals(["spec", "implement", "land"]);
export type Boundary = typeof Boundary.Type;

export const BOUNDARIES: ReadonlyArray<Boundary> = [
  "spec",
  "implement",
  "land",
];

// Clean passes in a row that earn a Milestone.
export const AUTONOMY_THRESHOLD = 5;

// An offer of Autonomy at one boundary of a Project, which the developer accepts or declines.
export class Milestone extends Schema.Class<Milestone>("Milestone")({
  id: Schema.String,
  project: Schema.String,
  boundary: Boundary,
  status: MilestoneStatus,
  offeredAt: Schema.DateTimeUtcFromMillis,
  decidedAt: Schema.optional(Schema.DateTimeUtcFromMillis),
}) {}

// Where one earnable boundary stands, for a Project and one of its Sessions.
export const BoundaryAutonomy = Schema.Struct({
  boundary: Boundary,
  // Clean passes in a row since the last declined Checkpoint, Milestone or withdrawal.
  streak: Schema.Finite,
  threshold: Schema.Finite,
  // Whether Fern approves this boundary itself.
  granted: Schema.Boolean,
  // The Milestone waiting on the developer, if any.
  offer: Schema.optional(Milestone),
  // Whether Fern approved this boundary in the Session.
  approvedByFern: Schema.Boolean,
  // Why Autonomy here was last withdrawn (an Escape slipped past it), until a Milestone here is
  // decided again.
  withdrawn: Schema.optional(
    Schema.Struct({
      reason: Schema.String,
      at: Schema.DateTimeUtcFromMillis,
    }),
  ),
});
export type BoundaryAutonomy = typeof BoundaryAutonomy.Type;

// A Hosted Session's Project's Autonomy, with what Fern approved in the Session.
export class SessionAutonomy extends Schema.Class<SessionAutonomy>(
  "SessionAutonomy",
)({
  sessionId: Schema.String,
  project: Schema.String,
  // The end of Spec, the end of Implement, then Land.
  boundaries: Schema.Array(BoundaryAutonomy),
}) {}

export class MilestoneNotFound extends Schema.TaggedError<MilestoneNotFound>()(
  "MilestoneNotFound",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

// The Milestone was accepted, declined or withdrawn already.
export class MilestoneClosed extends Schema.TaggedError<MilestoneClosed>()(
  "MilestoneClosed",
  { id: Schema.String },
  { httpApiStatus: 409 },
) {}

export class AutonomyApi extends HttpApiGroup.make("autonomy")
  .add(
    // Grants Autonomy at the Milestone's boundary: Fern approves it itself from now on.
    HttpApiEndpoint.post("accept", "/milestones/:id/accept", {
      params: { id: Schema.NonEmptyString },
      success: HttpApiSchema.NoContent,
      error: [MilestoneNotFound, MilestoneClosed],
    }),
  )
  .add(
    // Keeps the boundary with the developer, and starts its streak over.
    HttpApiEndpoint.post("decline", "/milestones/:id/decline", {
      params: { id: Schema.NonEmptyString },
      success: HttpApiSchema.NoContent,
      error: [MilestoneNotFound, MilestoneClosed],
    }),
  )
  .prefix("/autonomy") {}
