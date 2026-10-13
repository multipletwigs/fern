import { assert, it } from "@effect/vitest";
import { AtomRegistry } from "effect/reactivity";
import {
  reviewAtAtom,
  reviewShownAtom,
  showReviewAtom,
} from "../src/review/atoms";

// The status above the composer and the Implement Checkpoint open a Session's Review tab on a
// Walkthrough.

it("asks for the Review tab, on the Walkthrough named, each time it's opened from outside", () => {
  const registry = AtomRegistry.make();
  const before = registry.get(reviewShownAtom("s1"));
  registry.set(showReviewAtom("s1"), { walkthrough: "w2" });
  assert.deepStrictEqual(registry.get(reviewAtAtom("s1")), {
    walkthrough: "w2",
  });
  const once = registry.get(reviewShownAtom("s1"));
  assert.notStrictEqual(once, before);
  registry.set(showReviewAtom("s1"), { walkthrough: "w2" });
  assert.notStrictEqual(registry.get(reviewShownAtom("s1")), once);
});

it("leaves other Sessions' Review tabs alone", () => {
  const registry = AtomRegistry.make();
  const before = registry.get(reviewShownAtom("s2"));
  registry.set(showReviewAtom("s1"), { walkthrough: "w2" });
  assert.strictEqual(registry.get(reviewAtAtom("s2")), undefined);
  assert.strictEqual(registry.get(reviewShownAtom("s2")), before);
});
