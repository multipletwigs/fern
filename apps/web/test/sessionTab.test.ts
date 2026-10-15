import { assert, it } from "@effect/vitest";
import { preferredTab } from "../src/session/sessionTab";

// Which of a Session's tabs shows: the Grill while a Round is open, the chat otherwise, the
// developer's own pick until a Round opens or closes, and the Review tab once something outside it
// asks for it.

it("shows the Grill while a Round is open, and the chat otherwise", () => {
  assert.strictEqual(
    preferredTab({ open: "r1", chosen: undefined, asked: undefined }),
    "grill",
  );
  assert.strictEqual(
    preferredTab({ open: undefined, chosen: undefined, asked: undefined }),
    "chat",
  );
});

it("keeps the developer's pick until a Round opens or closes", () => {
  const chosen = { round: undefined, tab: "agent:a1" } as const;
  assert.strictEqual(
    preferredTab({ open: undefined, chosen, asked: undefined }),
    "agent:a1",
  );
  assert.strictEqual(
    preferredTab({ open: "r1", chosen, asked: undefined }),
    "grill",
  );
});

it("shows the Review tab once it's asked for from outside, over the developer's pick", () => {
  assert.strictEqual(
    preferredTab({
      open: "r1",
      chosen: { round: "r1", tab: "chat" },
      asked: { round: "r1" },
    }),
    "review",
  );
});

it("a Round opened after the Review tab was asked for brings the Grill to the front", () => {
  assert.strictEqual(
    preferredTab({
      open: "r2",
      chosen: undefined,
      asked: { round: undefined },
    }),
    "grill",
  );
  assert.strictEqual(
    preferredTab({ open: "r2", chosen: undefined, asked: { round: "r1" } }),
    "grill",
  );
});
