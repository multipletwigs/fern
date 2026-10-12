import { DateTime, Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { ProjectNotFound } from "./Projects";
import { SubagentStatus } from "./States";

// The renderable shape of a Claude Code Session. Long tool output is truncated server-side so a
// live update stays small. Times travel as epoch millis because SSE data is plain JSON.

// A Session counts as live while its transcript was written to within this window.
export const LIVE_WINDOW_MS = 30_000;
// Fern's own writes can land this long after its turn ends; they don't make a Session "in use".
const HOSTED_TAIL_MS = 2_000;

// A message sent while a turn ran, until the agent has taken it in. Claude Code takes it in at the
// next tool call, or as a turn of its own once the turn ends, as with a slash command.
export const QueuedMessage = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  // How many images it carries.
  images: Schema.Finite,
  // Whether Claude Code has the message already, so it can no longer be taken back.
  delivered: Schema.Boolean,
});
export type QueuedMessage = typeof QueuedMessage.Type;

// The latest turn Fern ran on a Session itself, making it a Hosted Session.
export const HostedTurn = Schema.Struct({
  running: Schema.Boolean,
  endedAt: Schema.optional(Schema.DateTimeUtcFromMillis),
  // Why the turn stopped early, when it did.
  error: Schema.optional(Schema.String),
  // The size of the context window of the model the turn ran on, as the previous turn reported it
  // while this one runs.
  contextWindow: Schema.optional(Schema.Finite),
  // Messages sent during this turn that the agent hasn't taken in yet, in order.
  queued: Schema.optional(Schema.Array(QueuedMessage)),
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
  // The model to run this turn and the ones after on, as Claude Code names it, e.g. "opus".
  // Without one, the Session keeps its model.
  model: Schema.optional(Schema.NonEmptyString),
}).check(
  Schema.makeFilter((m) =>
    m.text.trim() !== "" || (m.images?.length ?? 0) > 0
      ? undefined
      : "a message needs text or an image",
  ),
);
export type OutgoingMessage = typeof OutgoingMessage.Type;

// Whether something is working on the Session: a turn Fern runs, or another process writing it.
export const isWorking = (
  lastActivityMs: number,
  turn: HostedTurn | undefined,
  nowMs: number,
) => turn?.running === true || isInUseElsewhere(lastActivityMs, turn, nowMs);

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
    // Tokens in the context window as of Claude's latest response.
    contextTokens: Schema.optional(Schema.Finite),
    // The context window's size, known once Fern has run a turn on the Session.
    contextWindow: Schema.optional(Schema.Finite),
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
  // The Project's folder in the git worktree Fern made for the Session, where it runs. Its code and
  // changes are read from there.
  worktree: Schema.optional(Schema.String),
  // Whether Fern made that worktree for this Session, a Hosted one, so archiving it removes the
  // worktree. Not so for another Session run there, such as Claude Code in a terminal.
  ownWorktree: Schema.optional(Schema.Boolean),
  lastActivityAt: Schema.DateTimeUtcFromMillis,
  hostedTurn: Schema.optional(HostedTurn),
}) {}

// The Sessions that ran in one repository, newest first: in its folder, or in a worktree Fern made
// for them.
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
  // Claude Code stopped before replying, and recorded "No response requested." in its place.
  unanswered: Schema.optional(Schema.Boolean),
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

// An Agent call: the Subagent it started, in place of a ToolCall. Its type and description come
// from the metadata Claude Code keeps beside the Subagent's transcript, else from the call's input.
export const Subagent = Schema.TaggedStruct("Subagent", {
  id: Schema.String,
  // The Agent call's tool_use id.
  callId: Schema.String,
  // Claude Code's id for the Subagent, once known.
  agentId: Schema.optional(Schema.String),
  // E.g. "Explore" or "general-purpose".
  agentType: Schema.String,
  description: Schema.String,
  status: SubagentStatus,
});

// A Subagent's Hand-back as the Session received it, in place of a bare notice: Claude Code delivers
// a background Subagent's Hand-back to the Session as a message from the Subagent.
export const HandBack = Schema.TaggedStruct("HandBack", {
  id: Schema.String,
  agentId: Schema.String,
  // E.g. "Explore" or "general-purpose".
  agentType: Schema.String,
  text: Schema.String,
});

export const TranscriptItem = Schema.Union([
  Prompt,
  Command,
  Interrupt,
  Notice,
  Text,
  Thinking,
  ToolCall,
  Subagent,
  HandBack,
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

// The message is with Claude Code already, so it can't be taken out of the queue.
export class MessageDelivered extends Schema.TaggedError<MessageDelivered>()(
  "MessageDelivered",
  { id: Schema.String, item: Schema.String },
  { httpApiStatus: 409 },
) {}

// Another process, such as Claude Code in a terminal, is writing this Session right now.
export class SessionInUse extends Schema.TaggedError<SessionInUse>()(
  "SessionInUse",
  { id: Schema.String },
  { httpApiStatus: 409 },
) {}

// Fern couldn't make a branch and worktree for a new Session, e.g. because the folder isn't a git
// repository with a commit to start from.
export class WorktreeError extends Schema.TaggedError<WorktreeError>()(
  "WorktreeError",
  { message: Schema.String },
  { httpApiStatus: 422 },
) {}

// The Session's worktree has changes not yet committed, which archiving it would throw away.
export class UncommittedChanges extends Schema.TaggedError<UncommittedChanges>()(
  "UncommittedChanges",
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
    // Sessions Fern is running a turn on right now.
    HttpApiEndpoint.get("running", "/running", {
      success: Schema.Array(Schema.String),
    }),
  )
  .add(
    // Starts a turn: Claude Code resumes the Session with this message. While a turn runs, the
    // message waits in the Session's queue instead. Progress arrives on the Transcript stream
    // (LiveRpcs).
    HttpApiEndpoint.post("send", "/:id/messages", {
      params: { id: Schema.NonEmptyString },
      payload: OutgoingMessage,
      success: HttpApiSchema.NoContent,
      error: [SessionNotFound, SessionBusy, SessionInUse, TranscriptError],
    }),
  )
  .add(
    // Starts a Hosted Session on a piece of work in a Project (ADR 0005): a branch from the tip of
    // `main`, named after the opening prompt, checked out in its own worktree, where the Session
    // runs. Its first message takes the opening prompt into the Grill: `/grill-with-docs <text>`.
    HttpApiEndpoint.post("start", "/", {
      payload: Schema.Struct({
        // The Project's folder, in the repository the branch is made in.
        root: Schema.NonEmptyString,
        // The opening prompt.
        message: OutgoingMessage,
      }),
      success: SessionRef,
      error: [ProjectNotFound, WorktreeError, TranscriptError],
    }),
  )
  .add(
    HttpApiEndpoint.post("interrupt", "/:id/interrupt", {
      params: { id: Schema.NonEmptyString },
      success: HttpApiSchema.NoContent,
    }),
  )
  .add(
    // Takes a message out of the Session's queue, unless Claude Code has it already.
    HttpApiEndpoint.delete("unqueue", "/:id/queue/:item", {
      params: { id: Schema.NonEmptyString, item: Schema.NonEmptyString },
      success: HttpApiSchema.NoContent,
      error: [MessageDelivered],
    }),
  )
  .add(
    // Archives a Session Fern started in a worktree (ADR 0005): stops its turn, removes its
    // worktree, and leaves it out of the sidebar from then on. Its branch is kept. A worktree with
    // uncommitted changes is only removed with `force`.
    HttpApiEndpoint.post("archive", "/:id/archive", {
      params: { id: Schema.NonEmptyString },
      payload: Schema.Struct({ force: Schema.optional(Schema.Boolean) }),
      success: HttpApiSchema.NoContent,
      error: [SessionNotFound, UncommittedChanges, WorktreeError],
    }),
  )
  .prefix("/sessions") {}
