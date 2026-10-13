import { Effect, Schedule } from "effect";
import { Atom } from "effect/reactivity";
import { ApiClient } from "../ApiClient";
import { isTransient } from "../transient";

// Where `claude`, `gh` and `git` stand, checked when Fern opens and again on each refresh, as by
// Settings' Re-check button. The page can load before the main process serves the API, so a
// request that didn't reach it is retried, for half a minute; any other failure is shown at once.
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
