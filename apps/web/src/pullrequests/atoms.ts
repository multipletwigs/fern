import type { PrListState } from "@repo/api";
import { Atom } from "effect/reactivity";
import { ApiClient } from "../ApiClient";
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

// How a Project's Pull requests page is filtered, kept while the page is out of sight.
export const pullRequestFiltersAtom = Atom.family((_root: string) =>
  Atom.make<PrFilters>(defaultFilters).pipe(Atom.keepAlive),
);
