import { assert, it } from "@effect/vitest";
import { ToolStatus } from "@repo/api";
import { needsAttention } from "../src/settings/needsAttention";

const ready = (tool: ToolStatus["tool"]) =>
  ToolStatus.make({ tool, state: "ready", version: "1.0.0" });

it("needs no attention while every tool is ready", () => {
  assert.isFalse(needsAttention([ready("claude"), ready("gh"), ready("git")]));
});

it("needs attention once any tool isn't ready", () => {
  for (const state of ["needs-attention", "missing", "unknown"] as const)
    assert.isTrue(
      needsAttention([
        ready("claude"),
        ToolStatus.make({ tool: "gh", state }),
        ready("git"),
      ]),
      state,
    );
});

// Fern runs without Stacks, so a missing gh-stack extension shows in Settings but never flags it.
it("needs no attention for gh-stack alone, as Stacks are optional", () => {
  assert.isFalse(
    needsAttention([
      ready("claude"),
      ready("gh"),
      ready("git"),
      ToolStatus.make({ tool: "gh-stack", state: "missing" }),
    ]),
  );
});
