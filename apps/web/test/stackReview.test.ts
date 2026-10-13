import { assert, it } from "@effect/vitest";
import {
  PullRequest,
  Section,
  type Verdict,
  Walkthrough,
  type WalkthroughStatus,
} from "@repo/api";
import { DateTime } from "effect";
import { reviewQueue } from "../src/review/queue";
import { prStatus } from "../src/walkthrough/review";

const at = DateTime.makeUnsafe(0);
const approved: Verdict = { kind: "approved", at };

const pr = (position: number) =>
  new PullRequest({
    number: 100 + position,
    url: `https://github.com/acme/app/pull/${100 + position}`,
    title: `Ticket ${position}`,
    position,
    ticket: position + 2,
  });

const section = (id: string, verdict?: Verdict) =>
  new Section({ id, title: id, explanation: "", hunks: [], verdict });

// The Walkthrough numbered `number`, of the PR at `position` when it has one.
const walkthrough = (
  number: number,
  position: number | undefined,
  init: {
    status?: WalkthroughStatus;
    sections?: ReadonlyArray<Section>;
    reviewed?: boolean;
  } = {},
) =>
  new Walkthrough({
    id: `w${number}`,
    sessionId: "s1",
    number,
    status: init.status ?? "ready",
    since: position === undefined ? "previous" : "pr",
    pr: position === undefined ? undefined : pr(position),
    createdAt: at,
    overlapping: [],
    sections: init.sections ?? [section(`s${number}`)],
    unexplained: [],
    reviewedAt: init.reviewed ? at : undefined,
  });

const order = (walkthroughs: ReadonlyArray<Walkthrough>) => [
  ...new Set(reviewQueue(walkthroughs).map((item) => item.walkthrough.id)),
];

it("lists the Stack's PRs bottom first, whatever order their Walkthroughs were written in", () => {
  assert.deepStrictEqual(
    order([walkthrough(1, 2), walkthrough(2, 1), walkthrough(3, 3)]),
    ["w2", "w1", "w3"],
  );
});

it("keeps a PR's Walkthroughs together, oldest first, and puts Walkthroughs of no PR after the Stack", () => {
  assert.deepStrictEqual(
    order([
      walkthrough(1, 1),
      walkthrough(2, undefined),
      walkthrough(3, 2),
      walkthrough(4, 1),
    ]),
    ["w1", "w4", "w3", "w2"],
  );
});

it("keeps a Session without a Stack in the order its Walkthroughs were written", () => {
  assert.deepStrictEqual(
    order([walkthrough(1, undefined), walkthrough(2, undefined)]),
    ["w1", "w2"],
  );
});

it("says how a PR's review stands across its Walkthroughs", () => {
  assert.deepStrictEqual(
    prStatus([walkthrough(1, 1, { status: "writing", sections: [] })]),
    { status: "Writing", tone: "writing" },
  );
  assert.deepStrictEqual(
    prStatus([
      walkthrough(1, 1, {
        sections: [section("a", approved), section("b"), section("c")],
      }),
    ]),
    { status: "2 to review", tone: "amber" },
  );
  assert.deepStrictEqual(
    prStatus([
      walkthrough(1, 1, {
        sections: [section("a", approved)],
        reviewed: true,
      }),
    ]),
    { status: "Reviewed", tone: "muted" },
  );
  assert.deepStrictEqual(
    prStatus([walkthrough(1, 1, { status: "failed", sections: [] })]),
    { status: "Failed", tone: "danger" },
  );
});
