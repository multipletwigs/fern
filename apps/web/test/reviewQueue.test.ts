import { assert, it } from "@effect/vitest";
import {
  Hunk,
  Section,
  UnexplainedChange,
  type Verdict,
  Walkthrough,
  type WalkthroughStatus,
} from "@repo/api";
import { DateTime } from "effect";
import {
  afterVerdict,
  openAt,
  reviewQueue,
  waitingCount,
} from "../src/review/queue";

const at = DateTime.makeUnsafe(0);
const approved: Verdict = { kind: "approved", at };
const rejected: Verdict = { kind: "rejected", note: "Rename it", at };

const hunk = (id: string) =>
  new Hunk({
    id,
    path: `src/${id}.ts`,
    header: "@@ -1 +1 @@",
    lines: ["-a", "+b"],
    omitted: 0,
    added: 1,
    removed: 1,
    notFromSession: false,
  });

const section = (id: string, verdict?: Verdict) =>
  new Section({
    id,
    title: `Section ${id}`,
    explanation: "",
    decisions: [],
    unplanned: false,
    hunks: [hunk(`${id}-hunk`)],
    verdict,
  });

const unexplained = (id: string, verdict?: Verdict) =>
  new UnexplainedChange({ hunk: hunk(id), verdict });

const walkthrough = (
  number: number,
  init: {
    status?: WalkthroughStatus;
    sections?: ReadonlyArray<Section>;
    unexplained?: ReadonlyArray<UnexplainedChange>;
    reviewed?: boolean;
  } = {},
) =>
  new Walkthrough({
    id: `w${number}`,
    sessionId: "s1",
    number,
    status: init.status ?? "ready",
    since: number === 1 ? "start" : "previous",
    createdAt: at,
    overlapping: [],
    sections: init.sections ?? [],
    unexplained: init.unexplained ?? [],
    reviewedAt: init.reviewed ? at : undefined,
  });

const keys = (walkthroughs: ReadonlyArray<Walkthrough>) =>
  reviewQueue(walkthroughs).map((item) => item.key);

it("lists each Walkthrough's Sections, then its Unexplained changes, oldest Walkthrough first", () => {
  assert.deepStrictEqual(
    keys([
      walkthrough(1, {
        sections: [section("a"), section("b")],
        unexplained: [unexplained("x")],
      }),
      walkthrough(2, {
        sections: [section("c")],
        unexplained: [unexplained("y"), unexplained("z")],
      }),
    ]),
    ["w1:a", "w1:b", "w1:x", "w2:c", "w2:y", "w2:z"],
  );
});

it("holds a place for a Walkthrough still being written, or one that failed", () => {
  const queue = reviewQueue([
    walkthrough(1, { status: "failed" }),
    walkthrough(2, { sections: [section("a")] }),
    walkthrough(3, { status: "writing" }),
  ]);
  assert.deepStrictEqual(
    queue.map((item) => [item.key, item.kind]),
    [
      ["w1", "failed"],
      ["w2:a", "section"],
      ["w3", "writing"],
    ],
  );
});

it("counts the Sections and Unexplained changes still waiting on a verdict", () => {
  assert.strictEqual(
    waitingCount([
      walkthrough(1, {
        sections: [section("a", approved), section("b", rejected)],
        unexplained: [unexplained("x", approved)],
        reviewed: true,
      }),
      walkthrough(2, {
        sections: [section("c", approved), section("d"), section("e")],
        unexplained: [unexplained("y"), unexplained("z", rejected)],
      }),
      walkthrough(3, { status: "writing" }),
    ]),
    3,
  );
});

it("counts nothing waiting in a Session with no Walkthrough", () => {
  assert.strictEqual(waitingCount([]), 0);
});

// Walkthrough 1 is Reviewed. Walkthrough 2 waits on its second Section and its Unexplained change,
// and Walkthrough 3 is being written.
const session = reviewQueue([
  walkthrough(1, {
    sections: [section("a", approved)],
    unexplained: [unexplained("x", rejected)],
    reviewed: true,
  }),
  walkthrough(2, {
    sections: [section("b", approved), section("c")],
    unexplained: [unexplained("y")],
  }),
  walkthrough(3, { status: "writing" }),
]);
const keyAt = (index: number | undefined) =>
  index === undefined ? undefined : session[index]?.key;

it("opens on the first item still waiting on a verdict", () => {
  assert.strictEqual(keyAt(openAt(session, undefined)), "w2:c");
});

it("opens on the newest item once nothing waits", () => {
  const reviewed = reviewQueue([
    walkthrough(1, { sections: [section("a", approved)], reviewed: true }),
    walkthrough(2, { sections: [section("b", rejected)], reviewed: true }),
  ]);
  assert.strictEqual(reviewed[openAt(reviewed, undefined) ?? -1]?.key, "w2:b");
});

it("opens a Walkthrough on its first item waiting, else its first item", () => {
  assert.strictEqual(keyAt(openAt(session, { walkthrough: "w2" })), "w2:c");
  assert.strictEqual(keyAt(openAt(session, { walkthrough: "w1" })), "w1:a");
  assert.strictEqual(keyAt(openAt(session, { walkthrough: "w3" })), "w3");
});

it("opens the item asked for, settled or not", () => {
  assert.strictEqual(keyAt(openAt(session, { item: "w1:x" })), "w1:x");
});

it("opens as if nothing were asked for when what was asked for is gone", () => {
  assert.strictEqual(keyAt(openAt(session, { item: "w9:q" })), "w2:c");
  assert.strictEqual(keyAt(openAt(session, { walkthrough: "w9" })), "w2:c");
});

it("opens nothing in an empty queue", () => {
  assert.strictEqual(openAt([], undefined), undefined);
});

it("snaps to the next item waiting after a verdict, past the settled ones", () => {
  // From Walkthrough 2's second Section to its Unexplained change.
  assert.strictEqual(keyAt(afterVerdict(session, 3)), "w2:y");
  // From its Unexplained change back round to its second Section, past the one being written.
  assert.strictEqual(keyAt(afterVerdict(session, 4)), "w2:c");
});

it("stays on the item after a verdict when nothing else waits", () => {
  const last = reviewQueue([
    walkthrough(1, { sections: [section("a", approved), section("b")] }),
  ]);
  assert.strictEqual(afterVerdict(last, 1), 1);
});
