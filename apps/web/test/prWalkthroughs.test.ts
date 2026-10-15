import { assert, it } from "@effect/vitest";
import { ListedPullRequest, PrWalkthrough, PrWalkthroughOf } from "@repo/api";
import {
  liveWalkthroughs,
  walkthroughMark,
  walkthroughOf,
} from "../src/pullrequests/prWalkthroughs";

// The Pull requests page shows each Foreign PR's Walkthrough as it stands, kept current while
// one is written, between fetches of the list.

const pr = (number: number, init: Partial<ListedPullRequest> = {}) =>
  new ListedPullRequest({
    number,
    url: `https://github.com/acme/app/pull/${number}`,
    title: `PR ${number}`,
    author: "monalisa",
    headRef: `branch-${number}`,
    baseRef: "main",
    headCommit: `${number}`.padStart(40, "a"),
    draft: false,
    state: "open",
    reviewRequested: false,
    ...init,
  });

const walkthrough = (state: PrWalkthrough["state"]) =>
  new PrWalkthrough({ state, head: "h" });

const fetched = [
  pr(1, { walkthrough: walkthrough("writing") }),
  pr(2),
  pr(3, { session: "hosted" }),
  pr(4, { walkthrough: walkthrough("unreviewed") }),
];

it("each Foreign PR shows its latest Walkthrough as it stands now, not as last fetched", () => {
  const live = liveWalkthroughs([
    new PrWalkthroughOf({ number: 1, walkthrough: walkthrough("unreviewed") }),
    new PrWalkthroughOf({ number: 2, walkthrough: walkthrough("writing") }),
    new PrWalkthroughOf({ number: 3, walkthrough: walkthrough("reviewed") }),
  ]);
  assert.deepStrictEqual(
    fetched.map((p) => [p.number, walkthroughOf(p, live)?.state]),
    [
      [1, "unreviewed"],
      [2, "writing"],
      // A Hosted Session's PR has its Session's Walkthroughs, never a Foreign PR's.
      [3, undefined],
      // Its only Walkthrough was replaced and is being written again elsewhere: none now.
      [4, undefined],
    ],
  );
});

it("until the live states arrive, each PR shows what the list was fetched with", () => {
  assert.deepStrictEqual(
    fetched.map((p) => walkthroughOf(p, undefined)?.state),
    ["writing", undefined, undefined, "unreviewed"],
  );
});

it("each state reads as a mark on the PR's row, amber where it waits on the developer", () => {
  assert.deepStrictEqual(
    (["writing", "failed", "unreviewed", "reviewed"] as const).map((state) =>
      walkthroughMark(walkthrough(state), "h"),
    ),
    [
      { label: "Writing Walkthrough…", tone: "muted" },
      { label: "Walkthrough failed", tone: "amber" },
      { label: "To review", tone: "amber" },
      { label: "Reviewed", tone: "muted" },
    ],
  );
});

// The mark of a Reviewed Walkthrough of the head "h", once the PR has moved on from it.
const stale = (newCommits?: number) =>
  walkthroughMark(
    new PrWalkthrough({ state: "reviewed", head: "h", newCommits }),
    "moved",
  );

it("a PR that got commits after its Walkthrough says how many, once GitHub counted them", () => {
  assert.deepStrictEqual(
    [stale(1), stale(3), stale()],
    [
      { label: "1 new commit since your Walkthrough", tone: "amber" },
      { label: "3 new commits since your Walkthrough", tone: "amber" },
      { label: "New commits since your Walkthrough", tone: "amber" },
    ],
  );
  // Being written, it says so, whatever head it's of.
  assert.deepStrictEqual(walkthroughMark(walkthrough("writing"), "moved"), {
    label: "Writing Walkthrough…",
    tone: "muted",
  });
});

it("the count of new commits stays while the live state is of the same head, and goes once it isn't", () => {
  const counted = pr(5, {
    walkthrough: new PrWalkthrough({
      state: "unreviewed",
      head: "h",
      newCommits: 2,
    }),
  });
  const now = (state: PrWalkthrough["state"], head: string) =>
    walkthroughOf(
      counted,
      liveWalkthroughs([
        new PrWalkthroughOf({
          number: 5,
          walkthrough: new PrWalkthrough({ state, head }),
        }),
      ]),
    );
  assert.deepStrictEqual(
    [now("reviewed", "h")?.state, now("reviewed", "h")?.newCommits],
    ["reviewed", 2],
  );
  assert.deepStrictEqual(
    [now("writing", "new")?.state, now("writing", "new")?.newCommits],
    ["writing", undefined],
  );
});
