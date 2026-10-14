import { Atom } from "effect/reactivity";
import type { ReviewTarget } from "./queue";

// What's open in a Session's Review tab, or a Foreign PR's review on the Pull requests page (keyed
// `pr:<repo>#<number>`), kept while it's out of sight. Until something is
// picked, the tab opens on the first item still waiting.
export const reviewAtAtom = Atom.family((_sessionId: string) =>
  Atom.make<ReviewTarget | undefined>(undefined).pipe(Atom.keepAlive),
);

// How many times something outside a Session's Review tab asked to show it; the Session switches
// to the tab each time this changes.
export const reviewShownAtom = Atom.family((_sessionId: string) =>
  Atom.make(0).pipe(Atom.keepAlive),
);

// How many of those asks the Session's tabs have acted on, so a Session drawn only after the ask, as
// when the Pull requests page opens one of its PRs, still switches to the tab, once.
export const reviewSeenAtom = Atom.family((_sessionId: string) =>
  Atom.make(0).pipe(Atom.keepAlive),
);

// Opens a Session's Review tab on a Walkthrough, a PR or an item, from outside it, as the status above
// the composer does.
export const showReviewAtom = Atom.family((sessionId: string) =>
  Atom.writable(
    (get) => get(reviewAtAtom(sessionId)),
    (ctx, target: ReviewTarget) => {
      ctx.set(reviewAtAtom(sessionId), target);
      ctx.set(
        reviewShownAtom(sessionId),
        ctx.get(reviewShownAtom(sessionId)) + 1,
      );
    },
  ),
);
