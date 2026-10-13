import { Effect, Schedule } from "effect";
import { Atom } from "effect/reactivity";
import { ApiClient } from "../ApiClient";

// Whether Settings is on screen in place of a Session. Picking a Session, or starting one, puts it
// away again.
export const settingsOpenAtom = Atom.make(false).pipe(Atom.keepAlive);

// Where `claude`, `gh` and `git` stand, checked when Fern opens and again on each refresh, as by
// Settings' Re-check button. The page can load before the main process serves the API, so a
// dropped request is retried.
export const toolsAtom = ApiClient.runtime
  .atom(
    Effect.gen(function* () {
      const client = yield* ApiClient;
      return yield* client.tools();
    }).pipe(Effect.retry(Schedule.spaced("1 second"))),
  )
  .pipe(Atom.keepAlive);
