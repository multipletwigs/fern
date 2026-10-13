import {
  ProjectNotFound,
  ProjectSettings as Settings,
  WorkspaceError,
} from "@repo/api";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { HostedSessions } from "../turn/HostedSessions";

const SettingsRow = Schema.Struct({
  project: Schema.String,
  stacks: Schema.Int,
});

// Each Project's settings, keyed by its folder, as the developer set them in Settings; the
// defaults for a Project they never changed.
export class ProjectSettings extends Context.Service<
  ProjectSettings,
  {
    // The Project's settings, whatever the folder: for Fern's own use, never the page's.
    of(root: string): Effect.Effect<Settings>;
    // The same, for a folder Fern knows as a Project.
    get(
      root: string,
    ): Effect.Effect<Settings, ProjectNotFound | WorkspaceError>;
    save(
      settings: typeof Settings.Encoded,
    ): Effect.Effect<Settings, ProjectNotFound | WorkspaceError>;
  }
>()("@repo/server/project/ProjectSettings") {
  static readonly layer = Layer.effect(
    ProjectSettings,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const hosted = yield* HostedSessions;

      const row = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: SettingsRow,
        execute: (project) =>
          sql`SELECT project, stacks FROM project_settings WHERE project = ${project}`,
      });

      const of = Effect.fn("ProjectSettings.of")(function* (root: string) {
        const found = yield* row(root).pipe(Effect.orDie);
        return new Settings({
          root,
          stacks: Option.match(found, {
            onNone: () => true,
            onSome: (r) => r.stacks === 1,
          }),
        });
      });

      // Only a folder Fern knows as a Project has settings the page can read or change.
      const known = (root: string) =>
        hosted.isProject(root).pipe(
          Effect.mapError((e) => new WorkspaceError({ message: e.message })),
          Effect.filterOrFail(
            (isProject) => isProject,
            () => new ProjectNotFound({ root }),
          ),
        );

      const get = Effect.fn("ProjectSettings.get")(function* (root: string) {
        yield* known(root);
        return yield* of(root);
      });

      const save = Effect.fn("ProjectSettings.save")(function* (
        settings: typeof Settings.Encoded,
      ) {
        yield* known(settings.root);
        yield* sql`INSERT INTO project_settings ${sql.insert({
          project: settings.root,
          stacks: settings.stacks ? 1 : 0,
        })}
          ON CONFLICT (project) DO UPDATE SET stacks = excluded.stacks`.pipe(
          Effect.orDie,
        );
        return yield* of(settings.root);
      });

      return ProjectSettings.of({ of, get, save });
    }),
  );
}
