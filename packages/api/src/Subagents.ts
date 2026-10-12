import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { SessionNotFound, TranscriptError, TranscriptItem } from "./Sessions";
import { SubagentStatus } from "./States";

// A Session's Subagents, each shown in its own tab on the Session's chat column.

// What both the tab and the Subagent's own view say of it.
const subagentFields = {
  // Claude Code's id for the Subagent.
  agentId: Schema.String,
  // The tool_use id of the Agent call that started it, once known.
  callId: Schema.optional(Schema.String),
  // E.g. "Explore" or "general-purpose"; "Subagent" when Claude Code recorded none.
  agentType: Schema.String,
  description: Schema.String,
  status: SubagentStatus,
  // When its first message was written.
  startedAt: Schema.optional(Schema.DateTimeUtcFromMillis),
  // The Subagent that started it, for one started by another Subagent.
  parentAgentId: Schema.optional(Schema.String),
};

// One of a Session's Subagents, as its tab shows it.
export class SubagentSummary extends Schema.Class<SubagentSummary>(
  "SubagentSummary",
)({
  ...subagentFields,
  // Whether the developer closed its tab. It stays closed for the Session until they reopen it.
  closed: Schema.Boolean,
}) {}

// The top of a Subagent's view, with what its own transcript says of its work.
export class SubagentHeader extends Schema.Class<SubagentHeader>(
  "SubagentHeader",
)({
  ...subagentFields,
  // From its first message to its last.
  durationMs: Schema.Finite,
  toolCalls: Schema.Finite,
  // Its last request's usage: what it read, cached or not, and what it wrote.
  tokens: Schema.Finite,
}) {}

// One live update of a Subagent's view: its header and Assignment, then its work as the full item
// order plus only the items that are new or changed since the previous update on the same stream,
// as with TranscriptUpdate.
export class SubagentUpdate extends Schema.Class<SubagentUpdate>(
  "SubagentUpdate",
)({
  header: SubagentHeader,
  // The prompt the agent gave the Subagent.
  assignment: Schema.String,
  order: Schema.Array(Schema.String),
  upserts: Schema.Array(TranscriptItem),
  // Its final answer, once it has one.
  handBack: Schema.optional(Schema.String),
}) {}

// The Session has no Subagent by this id.
export class SubagentNotFound extends Schema.TaggedError<SubagentNotFound>()(
  "SubagentNotFound",
  { sessionId: Schema.String, agentId: Schema.String },
  { httpApiStatus: 404 },
) {}

const subagentParams = {
  sessionId: Schema.NonEmptyString,
  agentId: Schema.NonEmptyString,
};

export class SubagentsApi extends HttpApiGroup.make("subagents")
  .add(
    // Closes the Subagent's tab, for the Session, until it's reopened.
    HttpApiEndpoint.post("close", "/:sessionId/:agentId/close", {
      params: subagentParams,
      success: HttpApiSchema.NoContent,
      error: [SessionNotFound, SubagentNotFound, TranscriptError],
    }),
    // Reopens a Subagent's closed tab.
    HttpApiEndpoint.post("reopen", "/:sessionId/:agentId/reopen", {
      params: subagentParams,
      success: HttpApiSchema.NoContent,
      error: [SessionNotFound, SubagentNotFound, TranscriptError],
    }),
  )
  .prefix("/subagents") {}
