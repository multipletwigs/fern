import { Atom } from "effect/reactivity";
import { ApiClient } from "../ApiClient";

// Whether a Project has a Pull requests page: its `origin` on GitHub and `gh` signed in. Asked
// again a while after the sidebar stops showing it, so signing in to `gh` soon shows.
export const pullRequestsAvailableAtom = Atom.family((root: string) =>
  ApiClient.query("pullRequests", "available", {
    query: { root },
    timeToLive: "1 minute",
  }),
);

// A Project's open PRs, asked of GitHub whenever the Pull requests page opens or refreshes. A
// failed refresh keeps the last list as its previous success.
export const pullRequestListAtom = Atom.family((root: string) =>
  ApiClient.query("pullRequests", "list", { query: { root } }),
);
