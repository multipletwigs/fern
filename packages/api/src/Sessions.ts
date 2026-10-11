import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

// The renderable shape of a Claude Code Session. Long tool output is truncated server-side so a
// live update stays small. Times travel as epoch millis because SSE data is plain JSON.

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
  },
) {}

export const Question = Schema.Struct({
  header: Schema.String,
  question: Schema.String,
  options: Schema.Array(Schema.String),
});

export const Prompt = Schema.TaggedStruct("Prompt", {
  id: Schema.String,
  text: Schema.String,
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
