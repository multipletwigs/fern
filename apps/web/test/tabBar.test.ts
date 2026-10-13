import { assert, it } from "@effect/vitest";
import { agentsMenu } from "../src/session/tabBar";

const running = (agentId: string) => ({ agentId, status: "running" as const });
const done = (agentId: string) => ({ agentId, status: "done" as const });
const failed = (agentId: string) => ({ agentId, status: "failed" as const });

it("counts the Subagents and how many are still working", () => {
  const menu = agentsMenu(
    [done("a"), running("b"), failed("c"), running("d"), done("e")],
    undefined,
  );
  assert.strictEqual(menu.count, 5);
  assert.strictEqual(menu.running, 2);
  assert.strictEqual(menu.active, undefined);
});

it("puts the selected Subagent in the bar as its one tab", () => {
  const menu = agentsMenu([done("a"), running("b"), done("c")], "b");
  assert.deepStrictEqual(menu.active, running("b"));
});

it("puts no Subagent in the bar when the selected one isn't listed", () => {
  const menu = agentsMenu([done("a")], "gone");
  assert.strictEqual(menu.active, undefined);
});
