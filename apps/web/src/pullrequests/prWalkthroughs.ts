import type {
  ListedPullRequest,
  PrWalkthrough,
  PrWalkthroughOf,
  PrWalkthroughState,
} from "@repo/api";

// Each Foreign PR's latest Walkthrough by its number, as the server says it stands now.
export type LiveWalkthroughs = ReadonlyMap<number, PrWalkthrough>;

export const liveWalkthroughs = (
  states: ReadonlyArray<PrWalkthroughOf>,
): LiveWalkthroughs => new Map(states.map((of) => [of.number, of.walkthrough]));

// Where the PR's latest Walkthrough stands: as the server says now, since the list is fetched once
// a minute and a Walkthrough being written finishes in between, or, until that's known, as the
// list was fetched. A Hosted Session's PR has its Session's Walkthroughs, never a Foreign PR's.
export const walkthroughOf = (
  pr: ListedPullRequest,
  live: LiveWalkthroughs | undefined,
): PrWalkthrough | undefined =>
  pr.session !== undefined
    ? undefined
    : live === undefined
      ? pr.walkthrough
      : live.get(pr.number);

const MARKS: Record<
  PrWalkthroughState,
  { readonly label: string; readonly tone: "amber" | "muted" }
> = {
  writing: { label: "Writing Walkthrough…", tone: "muted" },
  failed: { label: "Walkthrough failed", tone: "amber" },
  unreviewed: { label: "To review", tone: "amber" },
  reviewed: { label: "Reviewed", tone: "muted" },
};

// How a Foreign PR's row marks where its latest Walkthrough stands: amber where it waits on the
// developer.
export const walkthroughMark = (state: PrWalkthroughState) => MARKS[state];
