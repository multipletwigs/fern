import { Atom } from "effect/reactivity";
import type { ReviewQuote } from "./quote";
import type { ReviewTarget } from "./queue";

// What's open in a Session's Review tab, kept while the tab is out of sight. Until something is
// picked, the tab opens on the first item still waiting.
export const reviewAtAtom = Atom.family((_sessionId: string) =>
  Atom.make<ReviewTarget | undefined>(undefined).pipe(Atom.keepAlive),
);

// How many times something outside a Session's Review tab asked to show it; the Session switches
// to the tab each time this changes.
export const reviewShownAtom = Atom.family((_sessionId: string) =>
  Atom.make(0).pipe(Atom.keepAlive),
);

// Opens a Session's Review tab on a Walkthrough or an item, from outside it, as the status above
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

// The passage highlighted in a Session's Review tab, which the composer shows and sends with the
// next message. The composer stays out of the tab without one.
export const reviewQuoteAtom = Atom.family((_sessionId: string) =>
  Atom.make<ReviewQuote | undefined>(undefined).pipe(Atom.keepAlive),
);
