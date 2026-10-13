import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { DeveloperTool, DeveloperToolState } from "./States";

// What the developer can do about a tool that isn't ready: a page to install it from, a command to
// run, or both. Fern never runs either itself.
export class ToolFix extends Schema.Class<ToolFix>("ToolFix")({
  url: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
}) {}

// Where one of the developer's tools stands, as Fern's own processes see it.
export class ToolStatus extends Schema.Class<ToolStatus>("ToolStatus")({
  tool: DeveloperTool,
  state: DeveloperToolState,
  // As `--version` prints it, e.g. "2.50.1"; none when it couldn't be read.
  version: Schema.optional(Schema.String),
  // For `gh`, the GitHub login it's signed in as.
  account: Schema.optional(Schema.String),
  // One line on what's wrong, for anything not ready.
  detail: Schema.optional(Schema.String),
  fix: Schema.optional(ToolFix),
}) {}

// Top-level groups are exposed at the root of the client: `client.health()`.
export class SystemApi extends HttpApiGroup.make("system", {
  topLevel: true,
})
  .add(
    HttpApiEndpoint.get("health", "/health", {
      success: HttpApiSchema.NoContent,
    }),
  )
  .add(
    // `claude`, `gh`, `git` and `gh-stack`, in that order, each checked again. A tool that's missing is a
    // status like any other, never a failure.
    HttpApiEndpoint.get("tools", "/tools", {
      success: Schema.Array(ToolStatus),
    }),
  ) {}
