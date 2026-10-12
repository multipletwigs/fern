import { Atom } from "effect/reactivity";
import { ApiClient } from "../ApiClient";

// Every isolated Fern running from a worktree (`pnpm verify:up`), asked for again every few
// seconds: slots start and stop outside Fern, with nothing to tell it.
export const verifySlotsAtom = ApiClient.query(
  "verifySlots",
  "running",
  {},
).pipe(Atom.withRefresh("3 seconds"));
