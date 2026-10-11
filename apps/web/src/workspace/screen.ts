import type { SessionChanges } from "@repo/api";
import { Atom, AsyncResult } from "effect/reactivity";
import { sessionChangesAtom } from "../code/atoms";
import { transcriptAtom } from "../session/atoms";
import { walkthroughsAtom } from "../walkthrough/atoms";

// Stands in for a Session's changes while its Project isn't known yet.
export const noChangesAtom: Atom.Atom<
  AsyncResult.AsyncResult<SessionChanges, unknown>
> = Atom.make(AsyncResult.initial());

// What a Session's screen needs before it can be laid out: its transcript, its changes in the
// Project, and its Walkthroughs.
export const screenAtoms = (sessionId: string, root: string | undefined) =>
  [
    transcriptAtom(sessionId),
    root ? sessionChangesAtom(root, sessionId) : noChangesAtom,
    walkthroughsAtom(sessionId),
  ] as const;
