import type { Land } from "@repo/api";

// What the Land card offers for where its Stack stands: landing it, or trying again once GitHub
// refused, only while it waits on nothing; sending GitHub's reason to the agent once it refused.
// Nothing while Fern is landing it.
export const landControls = (land: Land) => ({
  heading: land.landing
    ? "Landing the Stack on main"
    : land.waiting.length > 0
      ? "Land waits on your review again"
      : land.refusal !== undefined
        ? "GitHub refused to land the Stack"
        : "Land the Stack on main?",
  action: land.refusal === undefined ? "Land" : "Try again",
  canLand: !land.landing && land.waiting.length === 0,
  canSend: !land.landing && land.refusal !== undefined,
});
