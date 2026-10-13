import { type LandWait, PullRequest, type Walkthrough } from "@repo/api";
import type { StackPr } from "../stack/Stacks";

// A PR of the Stack, as the Land Checkpoint shows it.
export const shownPr = (pr: StackPr) =>
  PullRequest.make({
    number: pr.number,
    url: pr.url,
    title: pr.title,
    position: pr.position,
    ticket: pr.ticket ?? undefined,
  });

// How many items of the Walkthrough still wait on a verdict.
const leftIn = (w: Walkthrough) =>
  w.sections.filter((s) => !s.verdict).length +
  w.unexplained.filter((u) => !u.verdict).length;

// Why a PR's Walkthroughs keep the Stack from landing, if they do.
const reviewOf = (all: ReadonlyArray<Walkthrough>) => {
  if (all.length === 0) return "It has no Walkthrough yet.";
  if (all.some((w) => w.status === "writing"))
    return "Its Walkthrough is being written.";
  if (all.some((w) => w.status === "failed"))
    return "Its Walkthrough couldn't be written. Try it again in the Review tab.";
  const left = all
    .filter((w) => w.reviewedAt === undefined)
    .reduce((n, w) => n + leftIn(w), 0);
  return all.some((w) => w.reviewedAt === undefined)
    ? `Its Walkthrough isn't Reviewed yet: ${left} left to review.`
    : undefined;
};

// What the Session's Stack waits on before it can Land, bottom first: every PR's Walkthroughs
// written and Reviewed, every Rejection fixed by a later Section, and, when the developer accepted
// any Findings, the PR with them up. Nothing once it can Land.
export const waitsOf = (
  prs: ReadonlyArray<StackPr>,
  walkthroughs: ReadonlyArray<Walkthrough>,
  rejections: ReadonlyArray<{
    readonly walkthroughId: string;
    readonly title: string;
  }>,
  findingsAccepted: boolean,
): ReadonlyArray<LandWait> => {
  const byPr = (pr: StackPr) =>
    walkthroughs.filter((w) => w.pr?.number === pr.number);
  const prOf = (walkthroughId: string) => {
    const number = walkthroughs.find((w) => w.id === walkthroughId)?.pr
      ?.number;
    const pr = prs.find((p) => p.number === number);
    return pr && shownPr(pr);
  };
  return [
    ...prs.flatMap((pr) => {
      const why = reviewOf(byPr(pr));
      return why === undefined ? [] : [{ pr: shownPr(pr), why }];
    }),
    ...rejections.map((r) => ({
      pr: prOf(r.walkthroughId),
      why: `Your Rejection of "${r.title}" has no fix on the Stack yet.`,
    })),
    ...(findingsAccepted && !prs.some((pr) => pr.kind === "findings")
      ? [
          {
            why: "The Setup changes from the Findings you accepted aren't up yet.",
          },
        ]
      : []),
  ];
};

// What Fern sends the Session when the developer sends it GitHub's refusal: the reason, the
// Stack, and how to fix it without touching GitHub.
export const refusalMessage = (
  reason: string,
  prs: ReadonlyArray<StackPr>,
) =>
  [
    "GitHub refused to land this Session's Stack:",
    reason,
    `The Stack, bottom first:\n${prs.map((pr) => `- PR #${pr.number} (${pr.title}): \`${pr.branch}\` at ${pr.mergeCommit}`).join("\n")}`,
    "Fix what GitHub refused in the PRs it's about. For each PR you change, from the lowest up, make its new head on top of its current head: merge in the new head of the PR below (for the bottom PR, merge `main` in to settle conflicts with it), then commit the fix there, if it belongs there. Every PR above one you change needs a new head too, so each still builds on the one below. Merge the top new head into this Session's branch, then report every new head, bottom first, with Fern's `prs_updated` tool, and Fern pushes them to their PRs. Never push, merge or open PRs on GitHub yourself. The developer tries landing the Stack again once you're done.",
  ].join("\n\n");
