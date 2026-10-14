import { assert, it } from "@effect/vitest";
import {
  ListedPullRequest,
  ListedStack,
  PrWalkthrough,
  PrWalkthroughOf,
  PullRequestList,
} from "@repo/api";
import { liveWalkthroughs } from "../src/pullrequests/prWalkthroughs";
import {
  authorChoices,
  defaultFilters,
  listStateOf,
  type PrFilters,
  presetOf,
  rowsOf,
  withPreset,
} from "../src/pullrequests/list";

// The Pull requests page narrows the fetched PRs like a generic list: filters that combine, presets
// that set them, and Stacks shown whole when only some of their PRs match.

// The developer, as `gh` is signed in.
const ME = "octocat";

const pr = (number: number, init: Partial<ListedPullRequest> = {}) =>
  new ListedPullRequest({
    number,
    url: `https://github.com/acme/app/pull/${number}`,
    title: `PR ${number}`,
    author: ME,
    headRef: `branch-${number}`,
    baseRef: "main",
    headCommit: `${number}`.padStart(40, "a"),
    draft: false,
    state: "open",
    reviewRequested: false,
    ...init,
  });

// A Stack of the PRs, bottom first.
const stack = (id: number, prs: ReadonlyArray<ListedPullRequest>) =>
  new ListedStack({ id, number: id - 900, prs });

const list = (
  stacks: ReadonlyArray<ListedStack>,
  lone: ReadonlyArray<ListedPullRequest>,
) => new PullRequestList({ repo: "acme/app", login: ME, stacks, lone });

const filters = (init: Partial<PrFilters> = {}): PrFilters => ({
  ...defaultFilters,
  ...init,
});

// What the page shows: each Stack's PRs, a dimmed one in brackets, then the lone PRs.
const shown = (
  fetched: PullRequestList,
  applied: PrFilters = defaultFilters,
) => {
  const rows = rowsOf(fetched, applied);
  return {
    stacks: rows.stacks.map((s) =>
      s.prs.map((row) => (row.dimmed ? `(${row.pr.number})` : row.pr.number)),
    ),
    lone: rows.lone.map((p) => p.number),
  };
};

it("shows the developer's open PRs by default: Mine", () => {
  assert.deepStrictEqual(
    shown(
      list(
        [stack(901, [pr(1, { author: "hubot" })])],
        [pr(2), pr(3, { author: "hubot" }), pr(4, { author: "OctoCat" })],
      ),
    ),
    { stacks: [], lone: [2, 4] },
  );
});

it("shows a Stack that only partly matches whole, bottom first, with the PRs that don't match dimmed", () => {
  assert.deepStrictEqual(
    shown(
      list(
        [
          stack(902, [pr(5), pr(6, { author: "hubot" }), pr(7)]),
          stack(901, [pr(1, { author: "hubot" }), pr(2, { author: "hubot" })]),
        ],
        [],
      ),
    ),
    { stacks: [[5, "(6)", 7]], lone: [] },
  );
});

it("an author filter shows everyone else's PRs, or one person's", () => {
  const fetched = list(
    [],
    [pr(1), pr(2, { author: "hubot" }), pr(3, { author: "monalisa" })],
  );
  assert.deepStrictEqual(
    shown(fetched, filters({ author: "others" })).lone,
    [2, 3],
  );
  assert.deepStrictEqual(
    shown(fetched, filters({ author: { login: "Monalisa" } })).lone,
    [3],
  );
  assert.deepStrictEqual(
    shown(fetched, filters({ author: "anyone" })).lone,
    [1, 2, 3],
  );
});

it("the review-requested filter shows only the PRs the developer is asked to review", () => {
  const fetched = list(
    [],
    [pr(1, { reviewRequested: true }), pr(2), pr(3, { reviewRequested: true })],
  );
  assert.deepStrictEqual(
    shown(fetched, filters({ reviewRequested: true })).lone,
    [1, 3],
  );
});

it("the draft filter shows only drafts, or only PRs ready for review", () => {
  const fetched = list([], [pr(1, { draft: true }), pr(2), pr(3)]);
  assert.deepStrictEqual(shown(fetched, filters({ draft: "draft" })).lone, [1]);
  assert.deepStrictEqual(
    shown(fetched, filters({ draft: "ready" })).lone,
    [2, 3],
  );
  assert.deepStrictEqual(
    shown(fetched, filters({ draft: "any" })).lone,
    [1, 2, 3],
  );
});

it("the state filter tells closed PRs from merged ones, fetched together", () => {
  const fetched = list(
    [stack(901, [pr(1, { state: "merged" }), pr(2, { state: "closed" })])],
    [pr(3, { state: "merged" }), pr(4, { state: "closed" })],
  );
  assert.deepStrictEqual(shown(fetched, filters({ state: "merged" })), {
    stacks: [[1, "(2)"]],
    lone: [3],
  });
  assert.deepStrictEqual(shown(fetched, filters({ state: "closed" })), {
    stacks: [["(1)", 2]],
    lone: [4],
  });
  assert.strictEqual(listStateOf(filters({ state: "merged" })), "closed");
  assert.strictEqual(listStateOf(filters({ state: "closed" })), "closed");
  assert.strictEqual(listStateOf(defaultFilters), "open");
});

it("search finds PRs by title, branch or number, whatever the case", () => {
  const fetched = list(
    [],
    [
      pr(12, { title: "Add Dark mode" }),
      pr(120, { headRef: "fix/dark-toggle" }),
      pr(7, { title: "Theme" }),
      pr(31),
    ],
  );
  const searched = (search: string) => shown(fetched, filters({ search })).lone;
  assert.deepStrictEqual(searched("dark"), [12, 120]);
  assert.deepStrictEqual(searched("  DARK-toggle "), [120]);
  assert.deepStrictEqual(searched("#12"), [12, 120]);
  assert.deepStrictEqual(searched("7"), [7]);
  assert.deepStrictEqual(searched(""), [12, 120, 7, 31]);
});

it("each preset sets whose PRs show, keeping the draft, Walkthrough, state and search filters; Mine is the default", () => {
  const narrowed = filters({
    author: { login: "hubot" },
    reviewRequested: true,
    draft: "ready",
    walkthrough: "stale",
    state: "merged",
    search: "theme",
  });
  const kept = {
    draft: "ready",
    walkthrough: "stale",
    state: "merged",
    search: "theme",
  } as const;
  assert.deepStrictEqual(withPreset(narrowed, "mine"), {
    author: "me",
    reviewRequested: false,
    ...kept,
  });
  assert.deepStrictEqual(withPreset(narrowed, "reviewRequested"), {
    author: "anyone",
    reviewRequested: true,
    ...kept,
  });
  assert.deepStrictEqual(withPreset(narrowed, "others"), {
    author: "others",
    reviewRequested: false,
    ...kept,
  });
  assert.deepStrictEqual(withPreset(narrowed, "all"), {
    author: "anyone",
    reviewRequested: false,
    ...kept,
  });

  assert.strictEqual(presetOf(defaultFilters), "mine");
  assert.strictEqual(presetOf(withPreset(narrowed, "others")), "others");
  assert.strictEqual(presetOf(narrowed), undefined);
  assert.strictEqual(
    presetOf(filters({ author: "me", reviewRequested: true })),
    undefined,
  );
});

it("filters combine: a PR shows only when it passes every one", () => {
  const fetched = list(
    [
      stack(901, [
        pr(1, { author: "hubot" }),
        pr(2, { author: "hubot", draft: true }),
        pr(3),
      ]),
    ],
    [
      pr(4, { author: "hubot", title: "Theme" }),
      pr(5, { author: "hubot", title: "Theme", draft: true }),
      pr(6, { title: "Theme" }),
    ],
  );
  assert.deepStrictEqual(
    shown(fetched, filters({ author: "others", draft: "ready" })),
    { stacks: [[1, "(2)", "(3)"]], lone: [4] },
  );
  assert.deepStrictEqual(
    shown(
      fetched,
      filters({ author: "others", draft: "ready", search: "theme" }),
    ),
    { stacks: [], lone: [4] },
  );
});

// A Foreign PR's latest Walkthrough, of the head `at`.
const walked = (
  state: PrWalkthrough["state"],
  at: string,
): Partial<ListedPullRequest> => ({
  walkthrough: new PrWalkthrough({ state, head: at }),
});
const HEAD = "1".padStart(40, "a");

it("the Walkthrough filter shows the PRs with none to read, one to review, one Reviewed, or one the PR has moved on from", () => {
  const fetched = list(
    [
      stack(901, [
        pr(1, walked("reviewed", HEAD)),
        pr(2, { headCommit: HEAD, ...walked("reviewed", "old") }),
        pr(3, { session: "hosted" }),
      ]),
    ],
    [
      pr(4),
      pr(5, { headCommit: HEAD, ...walked("unreviewed", HEAD) }),
      pr(6, { headCommit: HEAD, ...walked("unreviewed", "old") }),
      pr(7, walked("failed", HEAD)),
      pr(8, walked("writing", HEAD)),
      pr(9, { author: "hubot" }),
    ],
  );
  const by = (walkthrough: PrFilters["walkthrough"]) =>
    shown(fetched, filters({ walkthrough }));
  assert.deepStrictEqual(by("any"), {
    stacks: [[1, 2, 3]],
    lone: [4, 5, 6, 7, 8],
  });
  // A Hosted Session's PR has its Session's Walkthroughs: no Foreign PR's state.
  assert.deepStrictEqual(by("none"), {
    stacks: [],
    lone: [4, 7, 8],
  });
  assert.deepStrictEqual(by("unreviewed"), { stacks: [], lone: [5] });
  assert.deepStrictEqual(by("reviewed"), {
    stacks: [[1, "(2)", "(3)"]],
    lone: [],
  });
  assert.deepStrictEqual(by("stale"), {
    stacks: [["(1)", 2, "(3)"]],
    lone: [6],
  });
  // It combines with the others.
  assert.deepStrictEqual(
    shown(fetched, filters({ walkthrough: "none", author: "anyone" })),
    { stacks: [], lone: [4, 7, 8, 9] },
  );
});

it("the Walkthrough filter goes by each PR's Walkthrough as it stands now, not as last fetched", () => {
  const fetched = list([], [pr(1, walked("writing", HEAD)), pr(2)]);
  const live = liveWalkthroughs([
    new PrWalkthroughOf({
      number: 1,
      walkthrough: new PrWalkthrough({ state: "unreviewed", head: HEAD }),
    }),
  ]);
  const toReview = filters({ walkthrough: "unreviewed" });
  assert.strictEqual(
    rowsOf(fetched, toReview).empty?.text,
    "No pull requests match these filters.",
  );
  assert.deepStrictEqual(
    rowsOf(fetched, toReview, live).lone.map((p) => p.number),
    [1],
  );
});

// Every filter off, in a state.
const cleared = (state: PrFilters["state"]): PrFilters => ({
  author: "anyone",
  reviewRequested: false,
  draft: "any",
  walkthrough: "any",
  state,
  search: "",
});

it("when the filters hide every PR, says nothing matches and offers to clear them, keeping the state", () => {
  const fetched = list(
    [stack(901, [pr(1, { author: "hubot", state: "merged" })])],
    [pr(2, { author: "hubot", state: "merged" })],
  );
  const narrowed = filters({ state: "merged", draft: "draft", search: "x" });
  const rows = rowsOf(fetched, narrowed);
  assert.deepStrictEqual(rows.empty, {
    text: "No pull requests match these filters.",
    clear: cleared("merged"),
  });
  const clearedRows = rowsOf(fetched, rows.empty?.clear ?? narrowed);
  assert.isUndefined(clearedRows.empty);
  assert.lengthOf(clearedRows.lone, 1);
  assert.lengthOf(clearedRows.stacks, 1);
});

it("when GitHub has no PRs in the state, says so, offering to go back to the open PRs", () => {
  const merged = list([], [pr(1, { state: "closed" })]);
  assert.deepStrictEqual(rowsOf(merged, filters({ state: "merged" })).empty, {
    text: "No merged pull requests.",
    clear: cleared("open"),
  });
  assert.deepStrictEqual(rowsOf(list([], []), defaultFilters).empty, {
    text: "No open pull requests.",
  });
  assert.isUndefined(rowsOf(list([], [pr(1)]), defaultFilters).empty);
});

it("the author filter offers me, not me, anyone, and every other author with a PR listed, once each", () => {
  const fetched = list(
    [stack(901, [pr(1, { author: "monalisa" }), pr(2)])],
    [pr(3, { author: "hubot" }), pr(4, { author: "monalisa" })],
  );
  const offered = (applied: PrFilters) =>
    authorChoices(fetched, applied).map((c) => [c.label, c.author]);
  assert.deepStrictEqual(offered(defaultFilters), [
    ["Anyone", "anyone"],
    ["Me", "me"],
    ["Not me", "others"],
    ["hubot", { login: "hubot" }],
    ["monalisa", { login: "monalisa" }],
  ]);
  // One picked earlier stays offered after its PRs leave the list.
  assert.deepStrictEqual(
    offered(filters({ author: { login: "defunkt" } })).slice(3),
    [
      ["defunkt", { login: "defunkt" }],
      ["hubot", { login: "hubot" }],
      ["monalisa", { login: "monalisa" }],
    ],
  );
});
