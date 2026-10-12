import type { TranscriptItem } from "@repo/api";

// What a live stream of items sent so far: each item's id and encoded form.
export type Sent = ReadonlyMap<string, string>;

// The next update of a live stream of items: the full order, plus only the items that are new or
// changed since what was sent before.
export const diffItems = (sent: Sent, items: ReadonlyArray<TranscriptItem>) => {
  const next: Sent = new Map(
    items.map((item) => [item.id, JSON.stringify(item)]),
  );
  return {
    next,
    order: items.map((item) => item.id),
    upserts: items.filter((item) => sent.get(item.id) !== next.get(item.id)),
  };
};
