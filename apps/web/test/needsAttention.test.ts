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
