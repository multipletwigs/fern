import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

// One process a Verify slot started, such as its page's dev server or the app.
export class VerifyProcess extends Schema.Class<VerifyProcess>("VerifyProcess")(
  {
    // What it is, e.g. "vite" or "electron".
    name: Schema.String,
    pid: Schema.Int,
    alive: Schema.Boolean,
  },
) {}

// An isolated Fern an agent started from a worktree with `pnpm verify:up`, to check its change in
// the running app. Read from the manifest the slot keeps at ~/.fern/verify/N/slot.json.
export class VerifySlot extends Schema.Class<VerifySlot>("VerifySlot")({
  slot: Schema.Int,
  // The root of the worktree it runs from.
  worktree: Schema.String,
  // The branch checked out there; null on a detached HEAD.
  branch: Schema.NullOr(Schema.String),
  apiPort: Schema.Int,
  webPort: Schema.Int,
  // Where its page is served.
  pageUrl: Schema.String,
  processes: Schema.Array(VerifyProcess),
  startedAt: Schema.DateTimeUtcFromMillis,
}) {}

// A slot's manifest couldn't be read, or isn't in the shape `pnpm verify:up` writes.
export class VerifySlotError extends Schema.TaggedError<VerifySlotError>()(
  "VerifySlotError",
  { message: Schema.String },
  { httpApiStatus: 500 },
) {}

export class VerifySlotsApi extends HttpApiGroup.make("verifySlots")
  .add(
    // Every Verify slot with a process still running, by slot number. A slot whose processes have
    // all exited is left out, though its manifest is still on disk.
    HttpApiEndpoint.get("running", "/running", {
      success: Schema.Array(VerifySlot),
      error: VerifySlotError,
    }),
  )
  .prefix("/verify-slots") {}
