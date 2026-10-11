import { DateTime, Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { ProjectNotFound } from "./Projects";

// The renderable shape of a Claude Code Session. Long tool output is truncated server-side so a
// live update stays small. Times travel as epoch millis because SSE data is plain JSON.

// A Session counts as live while its transcript was written to within this window.
export const LIVE_WINDOW_MS = 30_000;
// Fern's own writes can land this long after its turn ends; they don't make a Session "in use".
const HOSTED_TAIL_MS = 2_000;

// The latest turn Fern ran on a Session itself, making it a Hosted Session.
export const HostedTurn = Schema.Struct({
  running: Schema.Boolean,
  endedAt: Schema.optional(Schema.DateTimeUtcFromMillis),
  // Why the turn stopped early, when it did.
  error: Schema.optional(Schema.String),
});
export type HostedTurn = typeof HostedTurn.Type;

// Whether something other than Fern, such as Claude Code in a terminal, is writing the Session.
export const isInUseElsewhere = (
  lastActivityMs: number,
  turn: HostedTurn | undefined,
  nowMs: number,
) => {
  if (turn?.running) return false;
  if (nowMs - lastActivityMs >= LIVE_WINDOW_MS) return false;
  return (
    turn?.endedAt === undefined ||
    lastActivityMs > DateTime.toEpochMillis(turn.endedAt) + HOSTED_TAIL_MS
  );
};

// The image types the Messages API accepts.
export const ImageMediaType = Schema.Literals([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
export type ImageMediaType = typeof ImageMediaType.Type;

// An image attached to a message: its type and base64 bytes.
export const ImageAttachment = Schema.Struct({
  mediaType: ImageMediaType,
  data: Schema.NonEmptyString,
});
export type ImageAttachment = typeof ImageAttachment.Type;

// What a send carries: text, images, or both, but never neither.
export const OutgoingMessage = Schema.Struct({
  text: Schema.String,
  images: Schema.optional(Schema.Array(ImageAttachment)),
}).check(
  Schema.makeFilter((m) =>
    m.text.trim() !== "" || (m.images?.length ?? 0) > 0
      ? undefined
      : "a message needs text or an image",
  ),
);
export type OutgoingMessage = typeof OutgoingMessage.Type;

export class SessionRef extends Schema.Class<SessionRef>("SessionRef")({
  id: Schema.String,
}) {}

export class SessionHeader extends Schema.Class<SessionHeader>("SessionHeader")(
  {
    id: Schema.String,
    title: Schema.String,
    cwd: Schema.optional(Schema.String),
    gitBranch: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    lastActivityAt: Schema.DateTimeUtcFromMillis,
    cacheExpiresAt: Schema.optional(Schema.DateTimeUtcFromMillis),
    hostedTurn: Schema.optional(HostedTurn),
  },
) {}

export class SessionSummary extends Schema.Class<SessionSummary>(
  "SessionSummary",
)({
  id: Schema.String,
  title: Schema.String,
  gitBranch: Schema.optional(Schema.String),
  lastActivityAt: Schema.DateTimeUtcFromMillis,
}) {}

// The Sessions that ran in one working directory, newest first.
export class Project extends Schema.Class<Project>("Project")({
  path: Schema.String,
  sessions: Schema.Array(SessionSummary),
}) {}

export const Question = Schema.Struct({
  header: Schema.String,
  question: Schema.String,
  options: Schema.Array(Schema.String),
});

export const Prompt = Schema.TaggedStruct("Prompt", {
  id: Schema.String,
  text: Schema.String,
  // Images sent with the message, as data URLs.
  images: Schema.optional(Schema.Array(Schema.String)),
});

export const Command = Schema.TaggedStruct("Command", {
  id: Schema.String,
  name: Schema.String,
  args: Schema.String,
});

export const Interrupt = Schema.TaggedStruct("Interrupt", {
  id: Schema.String,
});

export const Notice = Schema.TaggedStruct("Notice", {
  id: Schema.String,
  text: Schema.String,
});

export const Text = Schema.TaggedStruct("Text", {
  id: Schema.String,
  markdown: Schema.String,
});

export const Thinking = Schema.TaggedStruct("Thinking", {
  id: Schema.String,
  text: Schema.String,
});

export const ToolCall = Schema.TaggedStruct("ToolCall", {
  id: Schema.String,
  name: Schema.String,
  summary: Schema.String,
  input: Schema.String,
  // The file the call read or changed, as an absolute path.
  path: Schema.optional(Schema.String),
  result: Schema.optional(
    Schema.Struct({ text: Schema.String, isError: Schema.Boolean }),
  ),
  // Edit and Write calls carry their change as unified-diff style lines ("-old" / "+new").
  diff: Schema.optional(Schema.Array(Schema.String)),
  questions: Schema.optional(Schema.Array(Question)),
});

export const TranscriptItem = Schema.Union([
  Prompt,
  Command,
  Interrupt,
  Notice,
  Text,
  Thinking,
  ToolCall,
]);
export type TranscriptItem = typeof TranscriptItem.Type;

// One live update: the full item order plus only the items that are new or changed since the
// previous update on the same stream.
export class TranscriptUpdate extends Schema.Class<TranscriptUpdate>(
  "TranscriptUpdate",
)({
  header: SessionHeader,
  order: Schema.Array(Schema.String),
  upserts: Schema.Array(TranscriptItem),
}) {}

export class SessionNotFound extends Schema.TaggedError<SessionNotFound>()(
  "SessionNotFound",
  { id: Schema.optional(Schema.String) },
  { httpApiStatus: 404 },
) {}

// Fern is already running a turn on this Session.
export class SessionBusy extends Schema.TaggedError<SessionBusy>()(
  "SessionBusy",
  { id: Schema.String },
  { httpApiStatus: 409 },
) {}

// Another process, such as Claude Code in a terminal, is writing this Session right now.
export class SessionInUse extends Schema.TaggedError<SessionInUse>()(
  "SessionInUse",
  { id: Schema.String },
  { httpApiStatus: 409 },
) {}

export class TranscriptError extends Schema.TaggedError<TranscriptError>()(
  "TranscriptError",
  { message: Schema.String },
) {}

export class SessionsApi extends HttpApiGroup.make("sessions")
  .add(
    HttpApiEndpoint.get("current", "/current", {
      success: SessionRef,
      error: [SessionNotFound, TranscriptError],
    }),
  )
  .add(
    // Every Project, most recently active first, re-sent whenever a Session changes.
    HttpApiEndpoint.get("projects", "/projects", {
      success: HttpApiSchema.StreamSse({
        data: Schema.Array(Project),
        error: TranscriptError,
      }),
      error: TranscriptError,
    }),
  )
  .add(
    // Sessions Fern is running a turn on right now.
    HttpApiEndpoint.get("running", "/running", {
      success: Schema.Array(Schema.String),
    }),
  )
  .add(
    // Starts a turn: Claude Code resumes the Session with this message. Progress arrives on `live`.
    HttpApiEndpoint.post("send", "/:id/messages", {
      params: { id: Schema.NonEmptyString },
      payload: OutgoingMessage,
      success: HttpApiSchema.NoContent,
      error: [SessionNotFound, SessionBusy, SessionInUse, TranscriptError],
    }),
  )
  .add(
    // Starts a new Session in a Project's folder with this message, as /clear does in Claude Code.
    HttpApiEndpoint.post("start", "/", {
      payload: Schema.Struct({
        cwd: Schema.NonEmptyString,
        message: OutgoingMessage,
      }),
      success: SessionRef,
      error: [ProjectNotFound, TranscriptError],
    }),
  )
  .add(
    HttpApiEndpoint.post("interrupt", "/:id/interrupt", {
      params: { id: Schema.NonEmptyString },
      success: HttpApiSchema.NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.get("live", "/:id/live", {
      params: { id: Schema.NonEmptyString },
      success: HttpApiSchema.StreamSse({
        data: TranscriptUpdate,
        error: TranscriptError,
      }),
      error: [SessionNotFound, TranscriptError],
    }),
  )
  .prefix("/sessions") {}
