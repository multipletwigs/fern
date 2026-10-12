import { assert, it } from "@effect/vitest";
import { subagentTabs } from "../src/session/tabBar";

const running = (agentId: string) => ({ agentId, status: "running" as const });
const done = (agentId: string) => ({ agentId, status: "done" as const });
const failed = (agentId: string) => ({ agentId, status: "failed" as const });

const ids = (tabs: ReadonlyArray<{ agentId: string }>) =>
  tabs.map((tab) => tab.agentId);

it("shows every Subagent while there are four or fewer", () => {
  const { shown, overflow } = subagentTabs(
    [done("a"), running("b"), failed("c"), done("d")],
    undefined,
  );
  assert.deepStrictEqual(ids(shown), ["a", "b", "c", "d"]);
  assert.deepStrictEqual(ids(overflow), []);
});

it("overflows the oldest finished Subagents past four, keeping start order", () => {
  const { shown, overflow } = subagentTabs(
    [running("a"), done("b"), running("c"), failed("d"), done("e"), done("f")],
    undefined,
  );
  assert.deepStrictEqual(ids(shown), ["a", "c", "e", "f"]);
  assert.deepStrictEqual(ids(overflow), ["b", "d"]);
});

it("never overflows a running Subagent, even with more than four running", () => {
  const { shown, overflow } = subagentTabs(
    [
      running("a"),
      done("b"),
      running("c"),
      running("d"),
      running("e"),
      running("f"),
    ],
    undefined,
  );
  assert.deepStrictEqual(ids(shown), ["a", "c", "d", "e", "f"]);
  assert.deepStrictEqual(ids(overflow), ["b"]);
});

it("keeps the selected Subagent's tab shown, overflowing the next oldest instead", () => {
  const { shown, overflow } = subagentTabs(
    [done("a"), done("b"), done("c"), done("d"), done("e")],
    "a",
  );
  assert.deepStrictEqual(ids(shown), ["a", "c", "d", "e"]);
  assert.deepStrictEqual(ids(overflow), ["b"]);
});
