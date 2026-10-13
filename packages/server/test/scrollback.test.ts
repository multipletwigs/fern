import { assert, it } from "@effect/vitest";
import { scrollback } from "../src/terminal/scrollback";

// What a shell printed lately, as kept for a viewer who comes back.

it("keeps everything while it fits", () => {
  const kept = scrollback(100);
  kept.append("one\r\n");
  kept.append("two\r\n");
  assert.strictEqual(kept.text(), "one\r\ntwo\r\n");
});

it("drops the oldest lines once it's over its limit", () => {
  const kept = scrollback(12);
  kept.append("line-1\r\nline-2\r\n");
  kept.append("line-3\r\n");
  assert.strictEqual(kept.text(), "line-3\r\n");
});

it("never keeps a colour change cut in half", () => {
  const red = "\x1b[38;5;196m";
  const kept = scrollback(20);
  kept.append(`${red}error\x1b[0m\r\n`);
  kept.append(`${red}x`);
  assert.strictEqual(kept.text(), `${red}x`);
});

it("never keeps half a character", () => {
  const kept = scrollback(6);
  kept.append("🌿🌿🌿");
  kept.append("ok");
  assert.isFalse(/^[\uDC00-\uDFFF]/.test(kept.text()));
  assert.isAtMost(kept.text().length, 6);
  assert.include(kept.text(), "ok");
});

it("keeps only the latest lines through a long run of output", () => {
  const kept = scrollback(1000);
  for (let i = 1; i <= 100_000; i++) kept.append(`line-${i}\r\n`);
  const text = kept.text();
  assert.isAtMost(text.length, 1000);
  assert.isTrue(text.startsWith("line-"));
  assert.isTrue(text.endsWith("line-100000\r\n"));
});

it("can be shrunk to its latest lines", () => {
  const kept = scrollback(1000);
  kept.append("line-1\r\nline-2\r\nline-3\r\n");
  kept.shrink(10);
  assert.strictEqual(kept.text(), "line-3\r\n");
  kept.append("line-4\r\n");
  assert.strictEqual(kept.text(), "line-4\r\n");
});
