// How the developer moves through a review layout's items: `next` and `previous` step to the
// neighbouring item and stop at either end, as `j` and `k` do. `nextOpen` and `previousOpen` skip
// the settled items and wrap round, as after a verdict, landing back on the current item when it's
// the only one open.
export type Move = "next" | "previous" | "nextOpen" | "previousOpen";

// Where `move` goes from the item at `at`, given which items are settled: undefined when there's
// nowhere to go, as for an open move once every item is settled.
export function moveFrom(
  settled: ReadonlyArray<boolean>,
  at: number,
  move: Move,
): number | undefined {
  const count = settled.length;
  if (count === 0) return undefined;
  if (move === "next") return Math.min(at + 1, count - 1);
  if (move === "previous") return Math.max(at - 1, 0);
  const direction = move === "nextOpen" ? 1 : -1;
  for (let step = 1; step <= count; step++) {
    const i = (((at + direction * step) % count) + count) % count;
    if (!settled[i]) return i;
  }
  return undefined;
}
