import { assert, it } from "@effect/vitest";
import { moveFrom } from "../src/review/navigation";

// Five items, the second and fourth settled.
const settled = [false, true, false, true, false];

it("moves to the next open item, past the settled ones", () => {
  assert.strictEqual(moveFrom(settled, 0, "nextOpen"), 2);
  assert.strictEqual(moveFrom(settled, 2, "nextOpen"), 4);
});

it("wraps round to the first open item when none is left after the current one", () => {
  assert.strictEqual(moveFrom(settled, 4, "nextOpen"), 0);
});

it("stays on the current item when it is the only open one", () => {
  assert.strictEqual(moveFrom([true, false, true], 1, "nextOpen"), 1);
});

it("finds no open item once every item is settled", () => {
  assert.strictEqual(moveFrom([true, true, true], 1, "nextOpen"), undefined);
  assert.strictEqual(
    moveFrom([true, true, true], 1, "previousOpen"),
    undefined,
  );
});

it("steps to the neighbouring item, settled or not, and stops at either end", () => {
  assert.strictEqual(moveFrom(settled, 0, "next"), 1);
  assert.strictEqual(moveFrom(settled, 4, "next"), 4);
  assert.strictEqual(moveFrom(settled, 2, "previous"), 1);
  assert.strictEqual(moveFrom(settled, 0, "previous"), 0);
});

it("moves back to the previous open item, wrapping round to the last", () => {
  assert.strictEqual(moveFrom(settled, 4, "previousOpen"), 2);
  assert.strictEqual(moveFrom(settled, 1, "previousOpen"), 0);
  assert.strictEqual(moveFrom(settled, 0, "previousOpen"), 4);
});
