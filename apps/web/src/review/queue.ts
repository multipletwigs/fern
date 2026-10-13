import type {
  Section,
  UnexplainedChange,
  Verdict,
  Walkthrough,
  WalkthroughStatus,
} from "@repo/api";
import { moveFrom } from "./navigation";

// One thing in a Session's Review queue: a Section or an Unexplained change to give a verdict on.
// Keyed by its Walkthrough and its own id, so it keeps its place as the queue grows.
export type ReviewQueueItem =
  | {
      readonly kind: "section";
      readonly key: string;
      readonly walkthrough: Walkthrough;
      readonly section: Section;
      // Its place among its Walkthrough's Sections, from 0.
      readonly index: number;
    }
  | {
      readonly kind: "unexplained";
      readonly key: string;
      readonly walkthrough: Walkthrough;
      readonly change: UnexplainedChange;
    }
  // A Walkthrough with nothing to review yet: being written, or failed to be.
  | {
      readonly kind: Exclude<WalkthroughStatus, "ready">;
      readonly key: string;
      readonly walkthrough: Walkthrough;
    };

// Where a Walkthrough sits in the Review tab: under its PR, the Stack's bottom PR first, and after
// the Stack when it explains no PR; oldest first within each.
const reviewOrder = (a: Walkthrough, b: Walkthrough) =>
  (a.pr?.position ?? Infinity) - (b.pr?.position ?? Infinity) ||
  a.number - b.number;

// Everything the Review tab lists, in the order the developer reviews it: the Walkthroughs in
// review order, each one's Sections in order, then its Unexplained changes. One being written, or
// that failed, holds a single place.
export const reviewQueue = (
  walkthroughs: ReadonlyArray<Walkthrough>,
): ReadonlyArray<ReviewQueueItem> =>
  walkthroughs
    .toSorted(reviewOrder)
    .flatMap((walkthrough): ReadonlyArray<ReviewQueueItem> => {
      if (walkthrough.status !== "ready")
        return [{ kind: walkthrough.status, key: walkthrough.id, walkthrough }];
      return [
        ...walkthrough.sections.map((section, index): ReviewQueueItem => ({
          kind: "section",
          key: `${walkthrough.id}:${section.id}`,
          walkthrough,
          section,
          index,
        })),
        ...walkthrough.unexplained.map((change): ReviewQueueItem => ({
          kind: "unexplained",
          key: `${walkthrough.id}:${change.hunk.id}`,
          walkthrough,
          change,
        })),
      ];
    });

// The developer's verdict on an item, once they've given one.
export const verdictOf = (item: ReviewQueueItem): Verdict | undefined =>
  item.kind === "section"
    ? item.section.verdict
    : item.kind === "unexplained"
      ? item.change.verdict
      : undefined;

// The item still needs the developer's verdict. A Walkthrough being written, or that failed, has
// nothing to give one on.
export const isWaiting = (item: ReviewQueueItem) =>
  (item.kind === "section" || item.kind === "unexplained") &&
  verdictOf(item) === undefined;

// How many items across the Session's Walkthroughs still wait on a verdict, as the Review tab's
// badge counts them.
export const waitingCount = (walkthroughs: ReadonlyArray<Walkthrough>) =>
  reviewQueue(walkthroughs).filter(isWaiting).length;

// What the Review tab was asked to open: a Walkthrough, as the status above the composer asks, or
// one item by its key.
export type ReviewTarget =
  { readonly walkthrough: string } | { readonly item: string };

// An index `findIndex` found, or undefined for its -1.
const found = (index: number) => (index >= 0 ? index : undefined);

// Where the Review tab opens: the item asked for, or a Walkthrough's first item still waiting, else
// its first item. With nothing asked for, or what was asked for gone, the first item waiting in the
// whole queue, else the newest. Undefined in an empty queue.
export const openAt = (
  queue: ReadonlyArray<ReviewQueueItem>,
  target: ReviewTarget | undefined,
): number | undefined => {
  if (queue.length === 0) return undefined;
  if (target && "item" in target) {
    const index = found(queue.findIndex((item) => item.key === target.item));
    if (index !== undefined) return index;
  } else if (target) {
    const own = (item: ReviewQueueItem) =>
      item.walkthrough.id === target.walkthrough;
    const index =
      found(queue.findIndex((item) => own(item) && isWaiting(item))) ??
      found(queue.findIndex(own));
    if (index !== undefined) return index;
  }
  return found(queue.findIndex(isWaiting)) ?? queue.length - 1;
};

// Where the Review tab snaps once the developer gives the item at `at` a verdict: the next item
// still waiting, wrapping round, or the same item when nothing else waits.
export const afterVerdict = (
  queue: ReadonlyArray<ReviewQueueItem>,
  at: number,
) =>
  moveFrom(
    queue.map((item, index) => index === at || !isWaiting(item)),
    at,
    "nextOpen",
  ) ?? at;
