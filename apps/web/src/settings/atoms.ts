import { Effect, Schedule } from "effect";
import { Atom } from "effect/reactivity";
import { ApiClient } from "../ApiClient";
import { isTransient } from "../transient";

// Where `claude`, `gh`, `git` and `gh-stack` stand, checked when Fern opens and again on each
// refresh, as by Settings' Re-check button. The page can load before the main process serves the
// API, so a request that didn't reach it is retried, for half a minute; any other failure is shown
// at once.
export const toolsAtom = ApiClient.runtime
  .atom(
    Effect.gen(function* () {
      const client = yield* ApiClient;
      return yield* client.tools();
    }).pipe(
      Effect.retry({
        schedule: Schedule.spaced("1 second"),
        while: isTransient,
        times: 30,
      }),
    ),
  )
  .pipe(Atom.keepAlive);

// What saving a Project's settings makes stale.
export const projectSettingsKey = (root: string) => `project-settings:${root}`;

// A Project's settings, read again whenever they're saved.
export const projectSettingsAtom = Atom.family((root: string) =>
  ApiClient.query("projects", "settings", {
    query: { root },
    reactivityKeys: [projectSettingsKey(root)],
  }),
);

export const saveProjectSettingsAtom = ApiClient.mutation(
  "projects",
  "saveSettings",
);
