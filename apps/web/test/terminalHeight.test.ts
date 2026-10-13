import { assert, it } from "@effect/vitest";
import { clampTerminalHeight } from "../src/terminal/atoms";

it("keeps a dragged terminal height that fits", () => {
  assert.strictEqual(clampTerminalHeight(400, 900), 400);
});

it("keeps the terminal tall enough to type in", () => {
  assert.strictEqual(clampTerminalHeight(30, 900), 120);
});

it("leaves room above the terminal for the chat", () => {
  assert.strictEqual(clampTerminalHeight(880, 900), 700);
});

it("keeps the shortest height in a window too small for it", () => {
  assert.strictEqual(clampTerminalHeight(300, 250), 120);
});
