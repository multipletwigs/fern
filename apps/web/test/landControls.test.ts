import { assert, it } from "@effect/vitest";
import { type Land, PullRequest } from "@repo/api";
import { landControls } from "../src/flow/landControls";

const pr = new PullRequest({
  number: 101,
  url: "https://github.com/acme/app/pull/101",
  title: "Add the theme setting",
  position: 1,
  ticket: 3,
});

const land = (overrides: Partial<Land> = {}): Land => ({
  prs: [pr],
  url: pr.url,
  landing: false,
  waiting: [],
  ...overrides,
});

it("a Stack waiting on nothing can Land", () => {
  assert.deepStrictEqual(landControls(land()), {
    heading: "Land the Stack on main?",
    action: "Land",
    canLand: true,
    canSend: false,
  });
});

it("after GitHub refused, the reason can go to the agent and landing is tried again", () => {
  assert.deepStrictEqual(
    landControls(land({ refusal: "PR #101 has failing checks." })),
    {
      heading: "GitHub refused to land the Stack",
      action: "Try again",
      canLand: true,
      canSend: true,
    },
  );
});

it("a Stack waiting on the developer's review again can't land, even after a refusal", () => {
  const waiting = [{ pr, why: "Its Walkthrough is being written." }];
  assert.deepStrictEqual(
    landControls(land({ waiting, refusal: "PR #101 has failing checks." })),
    {
      heading: "Land waits on your review again",
      action: "Try again",
      canLand: false,
      canSend: true,
    },
  );
});

it("while Fern lands the Stack, nothing else can be done", () => {
  assert.deepStrictEqual(
    landControls(land({ landing: true, refusal: "Earlier refusal." })),
    {
      heading: "Landing the Stack on main",
      action: "Try again",
      canLand: false,
      canSend: false,
    },
  );
});
