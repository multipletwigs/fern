import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

// A Project's code, read from the folder its Sessions ran in. Only folders a Session ran in can be
// read, and only paths inside them.

export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()(
  "ProjectNotFound",
  { root: Schema.String },
  { httpApiStatus: 404 },
) {}

export class FileNotFound extends Schema.TaggedError<FileNotFound>()(
  "FileNotFound",
  { path: Schema.String },
  { httpApiStatus: 404 },
) {}

export class WorkspaceError extends Schema.TaggedError<WorkspaceError>()(
  "WorkspaceError",
  { message: Schema.String },
) {}

export class FileContent extends Schema.Class<FileContent>("FileContent")({
  // Relative to the Project's folder.
  path: Schema.String,
  content: Schema.String,
  // Why the content was left out, when it was.
  skipped: Schema.optional(Schema.Literals(["binary", "tooLarge"])),
  modifiedAt: Schema.DateTimeUtcFromMillis,
}) {}

// A slash command Claude Code offers in a Project: a skill, a custom command, or a built-in.
export class SlashCommand extends Schema.Class<SlashCommand>("SlashCommand")({
  // Without the leading slash.
  name: Schema.String,
  description: Schema.String,
  // What the command takes after its name, e.g. "<file>"; empty when nothing.
  argumentHint: Schema.String,
}) {}

// A file a Session changed, with its net line counts from git.
export class ChangedFile extends Schema.Class<ChangedFile>("ChangedFile")({
  // Relative to the Project's folder.
  path: Schema.String,
  added: Schema.Int,
  removed: Schema.Int,
  binary: Schema.Boolean,
}) {}

// What a Session changed in its Project: the working tree against the snapshot Fern took when the
// Session started, or, for a Session Fern never ran, against the last commit.
export class SessionChanges extends Schema.Class<SessionChanges>(
  "SessionChanges",
)({
  since: Schema.Literals(["start", "head"]),
  files: Schema.Array(ChangedFile),
}) {}

// How Fern treats one Project, as the developer set it in Settings.
export class ProjectSettings extends Schema.Class<ProjectSettings>(
  "ProjectSettings",
)({
  root: Schema.String,
  // Whether Hosted Sessions land as a GitHub Stack, one draft PR per ticket, when the Project's
  // `origin` is on GitHub and `gh` is ready. On unless the developer opted out; off, work lands as
  // it did before Stacks.
  stacks: Schema.Boolean,
}) {}

export class ProjectsApi extends HttpApiGroup.make("projects")
  .add(
    // The slash commands Claude Code offers in the folder.
    HttpApiEndpoint.get("commands", "/commands", {
      query: { root: Schema.NonEmptyString },
      success: Schema.Array(SlashCommand),
      error: [ProjectNotFound, WorkspaceError],
    }),
  )
  .add(
    // The Project's settings; the defaults until the developer changes one.
    HttpApiEndpoint.get("settings", "/settings", {
      query: { root: Schema.NonEmptyString },
      success: ProjectSettings,
      error: [ProjectNotFound, WorkspaceError],
    }),
  )
  .add(
    // Changes the Project's settings, for Sessions started or reported from then on.
    HttpApiEndpoint.put("saveSettings", "/settings", {
      payload: Schema.Struct(ProjectSettings.fields),
      success: ProjectSettings,
      error: [ProjectNotFound, WorkspaceError],
    }),
  )
  .prefix("/projects") {}
