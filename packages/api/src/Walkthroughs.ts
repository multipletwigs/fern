import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { SessionBusy, SessionInUse, SessionNotFound } from "./Sessions";

// A Walkthrough explains what a Session changed since its previous Walkthrough, or since it
// started, in Sections the developer approves or rejects one by one. Fern takes the change from
// git snapshots, so every changed line is either claimed by a Section or shown as an Unexplained
// change.

// The developer's call on a Section or an Unexplained change. A Rejection always carries a note.
export const Verdict = Schema.Struct({
  kind: Schema.Literals(["approved", "rejected"]),
  note: Schema.optional(Schema.String),
  at: Schema.DateTimeUtcFromMillis,
});
export type Verdict = typeof Verdict.Type;

export class Hunk extends Schema.Class<Hunk>("Hunk")({
  id: Schema.String,
  // Relative to the repository's root.
  path: Schema.String,
  // The unified-diff hunk header, or what changed when there are no lines, e.g. a binary file.
  header: Schema.String,
  // Unified-diff lines: " context", "+added", "-removed".
  lines: Schema.Array(Schema.String),
  // Lines left out of `lines` to keep the update small.
  omitted: Schema.Int,
  added: Schema.Int,
  removed: Schema.Int,
  // The Fork found no tool call of its own that made this hunk.
  notFromSession: Schema.Boolean,
}) {}

export class Section extends Schema.Class<Section>("Section")({
  id: Schema.String,
  title: Schema.String,
  // Markdown.
  explanation: Schema.String,
  // One line on an approach tried and dropped on the way, when there was one.
  dropped: Schema.optional(Schema.String),
  // The earlier Rejection this Section addresses.
  fixes: Schema.optional(
    Schema.Struct({ walkthrough: Schema.Int, title: Schema.String }),
  ),
  hunks: Schema.Array(Hunk),
  verdict: Schema.optional(Verdict),
}) {}

export class UnexplainedChange extends Schema.Class<UnexplainedChange>(
  "UnexplainedChange",
)({
  hunk: Hunk,
  verdict: Schema.optional(Verdict),
}) {}

export const WalkthroughStatus = Schema.Literals([
  "writing",
  "ready",
  "failed",
]);
export type WalkthroughStatus = typeof WalkthroughStatus.Type;

// Where a Walkthrough's change starts: the previous Walkthrough, the snapshot Fern took when the
// Session started, or, for a Session Fern never ran, the last commit.
export const WalkthroughSince = Schema.Literals(["previous", "start", "head"]);
export type WalkthroughSince = typeof WalkthroughSince.Type;

export class Walkthrough extends Schema.Class<Walkthrough>("Walkthrough")({
  id: Schema.String,
  sessionId: Schema.String,
  // 1 for the Session's first Walkthrough.
  number: Schema.Int,
  status: WalkthroughStatus,
  // Why writing failed, when it did.
  error: Schema.optional(Schema.String),
  since: WalkthroughSince,
  createdAt: Schema.DateTimeUtcFromMillis,
  // Other Sessions Fern ran in the same repository while this change was made. Their edits can't
  // be told apart from this Session's.
  overlapping: Schema.Array(Schema.String),
  sections: Schema.Array(Section),
  unexplained: Schema.Array(UnexplainedChange),
  // Set once every Section and Unexplained change has a verdict.
  reviewedAt: Schema.optional(Schema.DateTimeUtcFromMillis),
  // The Rejection notes went back to the Session as one message.
  redirectSentAt: Schema.optional(Schema.DateTimeUtcFromMillis),
  // Why sending them failed, when it did.
  redirectError: Schema.optional(Schema.String),
}) {}

// What the developer says about one Section or Unexplained change.
export const VerdictInput = Schema.Struct({
  kind: Schema.Literals(["approved", "rejected"]),
  note: Schema.optional(Schema.String),
}).check(
  Schema.makeFilter((v) =>
    v.kind === "approved" || (v.note ?? "").trim() !== ""
      ? undefined
      : "a rejection needs a note",
  ),
);
export type VerdictInput = typeof VerdictInput.Type;

export class WalkthroughNotFound extends Schema.TaggedError<WalkthroughNotFound>()(
  "WalkthroughNotFound",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

// The id names neither a Section nor an Unexplained change of the Walkthrough.
export class ReviewItemNotFound extends Schema.TaggedError<ReviewItemNotFound>()(
  "ReviewItemNotFound",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

// Nothing changed since the previous Walkthrough, so there is nothing to explain.
export class NothingToReview extends Schema.TaggedError<NothingToReview>()(
  "NothingToReview",
  { sessionId: Schema.String },
  { httpApiStatus: 409 },
) {}

// A Walkthrough of this Session is being written already.
export class WalkthroughInProgress extends Schema.TaggedError<WalkthroughInProgress>()(
  "WalkthroughInProgress",
  { sessionId: Schema.String },
  { httpApiStatus: 409 },
) {}

// The Walkthrough isn't open for verdicts: still being written, failed, or already Reviewed.
export class ReviewClosed extends Schema.TaggedError<ReviewClosed>()(
  "ReviewClosed",
  { id: Schema.String },
  { httpApiStatus: 409 },
) {}

export class WalkthroughError extends Schema.TaggedError<WalkthroughError>()(
  "WalkthroughError",
  { message: Schema.String },
) {}

export class WalkthroughsApi extends HttpApiGroup.make("walkthroughs")
  .add(
    // A Session's Walkthroughs, oldest first, re-sent whenever one changes.
    HttpApiEndpoint.get("list", "/", {
      query: { session: Schema.NonEmptyString },
      success: HttpApiSchema.StreamSse({
        data: Schema.Array(Walkthrough),
        error: WalkthroughError,
      }),
      error: WalkthroughError,
    }),
  )
  .add(
    // Starts writing a Walkthrough of what changed since the last one. Fern also does this on its own
    // whenever a turn it ran finishes.
    HttpApiEndpoint.post("write", "/", {
      payload: Schema.Struct({ session: Schema.NonEmptyString }),
      success: HttpApiSchema.NoContent,
      error: [
        SessionNotFound,
        NothingToReview,
        WalkthroughInProgress,
        WalkthroughError,
      ],
    }),
  )
  .add(
    // Approves or rejects a Section or an Unexplained change. The last verdict makes the Walkthrough
    // Reviewed and sends any Rejection notes back to the Session.
    HttpApiEndpoint.put("verdict", "/:id/items/:item/verdict", {
      params: { id: Schema.NonEmptyString, item: Schema.NonEmptyString },
      payload: VerdictInput,
      success: HttpApiSchema.NoContent,
      error: [
        WalkthroughNotFound,
        ReviewItemNotFound,
        ReviewClosed,
        WalkthroughError,
      ],
    }),
  )
  .add(
    // Sends a Reviewed Walkthrough's Rejection notes to the Session again, after a failed send.
    HttpApiEndpoint.post("redirect", "/:id/redirect", {
      params: { id: Schema.NonEmptyString },
      success: HttpApiSchema.NoContent,
      error: [
        WalkthroughNotFound,
        ReviewClosed,
        SessionNotFound,
        SessionBusy,
        SessionInUse,
        WalkthroughError,
      ],
    }),
  )
  .prefix("/walkthroughs") {}
