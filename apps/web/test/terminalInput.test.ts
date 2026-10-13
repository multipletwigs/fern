import { assert, it } from "@effect/vitest";
import { TERMINAL_INPUT_MAX } from "@repo/api";
import { outgoing } from "../src/terminal/outgoing";

const input = (data: string) => ({ _tag: "Input", data }) as const;

it("sends keystrokes typed back to back as one write", () => {
  assert.deepStrictEqual(outgoing([input("l"), input("s"), input("\r")]), [
    input("ls\r"),
  ]);
});

it("keeps a resize between keystrokes in its place", () => {
  const resize = { _tag: "Resize", cols: 100, rows: 30 } as const;
  assert.deepStrictEqual(outgoing([input("a"), resize, input("b")]), [
    input("a"),
    resize,
    input("b"),
  ]);
});

it("sends a paste bigger than the server takes at once in pieces, in order", () => {
  const paste = "x".repeat(TERMINAL_INPUT_MAX * 2 + 10);
  const sent = outgoing([input(paste)]);
  assert.deepStrictEqual(
    sent.map((m) => (m._tag === "Input" ? m.data.length : 0)),
    [TERMINAL_INPUT_MAX, TERMINAL_INPUT_MAX, 10],
  );
  assert.strictEqual(
    sent.map((m) => (m._tag === "Input" ? m.data : "")).join(""),
    paste,
  );
});

it("never splits a character between two pieces", () => {
  const paste = `${"x".repeat(TERMINAL_INPUT_MAX - 1)}🌿tail`;
  const sent = outgoing([input(paste)]).map((m) =>
    m._tag === "Input" ? m.data : "",
  );
  assert.deepStrictEqual(sent, ["x".repeat(TERMINAL_INPUT_MAX - 1), "🌿tail"]);
});
