import type { PrListState } from "@repo/api";
import { Effect, Schedule, Stream } from "effect";
import { Atom } from "effect/reactivity";
import { ApiClient } from "../ApiClient";
import { LiveClient } from "../LiveClient";
import { resubscribe } from "../resubscribe";
import { defaultFilters, type PrFilters } from "./list";

// Whether a Project has a Pull requests page: its `origin` on GitHub and `gh` signed in. Asked
// again a while after the sidebar stops showing it, so signing in to `gh` soon shows.
export const pullRequestsAvailableAtom = Atom.family((root: string) =>
  ApiClient.query("pullRequests", "available", {
    query: { root },
    timeToLive: "1 minute",
  }),
);

// A Project's open PRs, or its closed and merged ones, asked of GitHub whenever the Pull requests
// page opens or refreshes. A failed refresh keeps the last list as its previous success. One
// family keyed by both, as a family of families can drop the inner one.
const listFamily = Atom.family((key: string) => {
  const [root = "", state = "open"] = key.split("\0");
  return ApiClient.query("pullRequests", "list", {
    query: { root, state: state === "closed" ? "closed" : "open" },
  });
});
export const pullRequestListAtom = (root: string, state: PrListState) =>
  listFamily(`${root}\0${state}`);

// The Foreign PR whose Walkthroughs are open on a Project's Pull requests page, by its number, kept
// while the page is out of sight. None while the page shows its list.
export const openPullRequestAtom = Atom.family((_root: string) =>
  Atom.make<number | undefined>(undefined).pipe(Atom.keepAlive),
);

// What a Foreign PR's review is kept by, as `reviewAtAtom` keys it.
export const prReviewKey = (repo: string, number: number) =>
  `pr:${repo}#${number}`;

// A Foreign PR's Walkthroughs, oldest first, kept current by the server, keyed by `prReviewKey`.
// Stays loaded a while after it leaves the screen, like a Session's.
export const prWalkthroughsAtom = Atom.family((key: string) => {
  const [, repo = "", number = "0"] = /^pr:(.+)#(\d+)$/.exec(key) ?? [];
  return LiveClient.runtime
    .atom(
      Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* LiveClient;
          return client("PullRequestWalkthroughs", {
            repo,
            number: Number(number),
          });
        }),
      ).pipe(resubscribe(Schedule.spaced("2 seconds"))),
    )
    .pipe(Atom.setIdleTTL("1 minute"));
});

// The latest Walkthrough of each of a repo's Foreign PRs, kept current by the server, so a PR
// shows one being written as it finishes, between fetches of the list.
export const prWalkthroughStatesAtom = Atom.family((repo: string) =>
  LiveClient.runtime
    .atom(
      Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* LiveClient;
          return client("PullRequestWalkthroughStates", { repo });
        }),
      ).pipe(resubscribe(Schedule.spaced("2 seconds"))),
    )
    .pipe(Atom.setIdleTTL("1 minute")),
);

export const walkThroughAtom = ApiClient.mutation(
  "pullRequests",
  "walkThrough",
);

export const tryItAtom = ApiClient.mutation("pullRequests", "tryIt");

export const dismissWorktreeAtom = ApiClient.mutation(
  "pullRequests",
  "dismiss",
);

// How a Project's Pull requests page is filtered, kept while the page is out of sight.
export const pullRequestFiltersAtom = Atom.family((_root: string) =>
  Atom.make<PrFilters>(defaultFilters).pipe(Atom.keepAlive),
);
