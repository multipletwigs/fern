import {
  type ForeignPrState,
  type ListedPullRequest,
  PrWalkthrough,
  type PrWalkthroughOf,
  type PrWalkthroughState,
} from "@repo/api";

// Each Foreign PR's latest Walkthrough by its number, as the server says it stands now.
export type LiveWalkthroughs = ReadonlyMap<number, PrWalkthrough>;

export const liveWalkthroughs = (
  states: ReadonlyArray<PrWalkthroughOf>,
): LiveWalkthroughs => new Map(states.map((of) => [of.number, of.walkthrough]));

// Where the PR's latest Walkthrough stands: as the server says now, since the list is fetched once
// a minute and a Walkthrough being written finishes in between, or, until that's known, as the
// list was fetched. The count of new commits only comes with the list, so it stays while the live
// one is of the same head. A Hosted Session's PR has its Session's Walkthroughs, never a Foreign
// PR's.
export const walkthroughOf = (
  pr: ListedPullRequest,
  live: LiveWalkthroughs | undefined,
): PrWalkthrough | undefined => {
  if (pr.session !== undefined) return undefined;
  if (live === undefined) return pr.walkthrough;
  const now = live.get(pr.number);
  const newCommits = pr.walkthrough?.newCommits;
  return now === undefined ||
    newCommits === undefined ||
    now.head !== pr.walkthrough?.head
    ? now
    : new PrWalkthrough({
        state: now.state,
        head: now.head,
        error: now.error,
        newCommits,
      });
};

// Whether the PR's head has moved on from its latest Walkthrough, once one is written.
const isStale = (walkthrough: PrWalkthrough, head: string) =>
  (walkthrough.state === "unreviewed" || walkthrough.state === "reviewed") &&
  walkthrough.head !== head;

// Where a Foreign PR stands with its latest Walkthrough, `walkthrough`; none for a Hosted Session's
// PR.
export const foreignPrStateOf = (
  pr: ListedPullRequest,
  walkthrough: PrWalkthrough | undefined,
): ForeignPrState | undefined => {
  if (pr.session !== undefined) return undefined;
  if (walkthrough === undefined) return "none";
  if (isStale(walkthrough, pr.headCommit)) return "stale";
  return walkthrough.state === "unreviewed" || walkthrough.state === "reviewed"
    ? walkthrough.state
    : "none";
};

// Whether walking the Foreign PR through would write anything: its latest Walkthrough isn't at its
// head, and none is being written.
export const walkable = (
  pr: ListedPullRequest,
  walkthrough: PrWalkthrough | undefined,
) => {
  const state = foreignPrStateOf(pr, walkthrough);
  return (
    state === "stale" || (state === "none" && walkthrough?.state !== "writing")
  );
};

type Mark = { readonly label: string; readonly tone: "amber" | "muted" };

const MARKS: Record<PrWalkthroughState, Mark> = {
  writing: { label: "Writing Walkthrough…", tone: "muted" },
  failed: { label: "Walkthrough failed", tone: "amber" },
  unreviewed: { label: "To review", tone: "amber" },
  reviewed: { label: "Reviewed", tone: "muted" },
};

const commits = (n: number) => `${n} new ${n === 1 ? "commit" : "commits"}`;

// How a Foreign PR's row marks where its latest Walkthrough stands, given the PR's head now: amber
// where it waits on the developer, as it does once the PR got commits since.
export const walkthroughMark = (
  walkthrough: PrWalkthrough,
  head: string,
): Mark =>
  isStale(walkthrough, head)
    ? {
        label:
          walkthrough.newCommits === undefined
            ? "New commits since your Walkthrough"
            : `${commits(walkthrough.newCommits)} since your Walkthrough`,
        tone: "amber",
      }
    : MARKS[walkthrough.state];

// What walking a Foreign PR through again offers once it got commits since its latest Walkthrough.
export const walkThroughNewLabel = (newCommits: number | undefined) =>
  newCommits === undefined
    ? "Walk through the new commits"
    : `Walk through ${commits(newCommits)}`;
