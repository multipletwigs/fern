import type {
  ForeignPrState,
  ListedPullRequest,
  ListedStack,
  PrListState,
  PrState,
  PullRequestList,
} from "@repo/api";
import {
  foreignPrStateOf,
  type LiveWalkthroughs,
  walkthroughOf,
} from "./prWalkthroughs";

// How the Pull requests page narrows the PRs it fetched, like a generic list: filters that combine,
// presets that set them, and Stacks shown whole when only some of their PRs pass. Everything the
// page shows of the list comes through `rowsOf`.

// Whose PRs show: anyone's, the developer's, everyone else's, or one person's, by GitHub login.
export type AuthorFilter =
  "anyone" | "me" | "others" | { readonly login: string };

// Drafts, PRs ready for review, or either.
export type DraftFilter = "any" | "draft" | "ready";

// Foreign PRs where they stand with their Walkthroughs, or any PR.
export type WalkthroughFilter = ForeignPrState | "any";

// What the page narrows the fetched PRs to. They combine: a PR passes when it passes every one.
export interface PrFilters {
  readonly author: AuthorFilter;
  // Only the PRs the developer is asked to review.
  readonly reviewRequested: boolean;
  readonly draft: DraftFilter;
  // A Hosted Session's PR has its Session's Walkthroughs, so it passes only "any".
  readonly walkthrough: WalkthroughFilter;
  readonly state: PrState;
  // Free text, over each PR's title, branch and number.
  readonly search: string;
}

// The page opens on the developer's own open PRs.
export const defaultFilters: PrFilters = {
  author: "me",
  reviewRequested: false,
  draft: "any",
  walkthrough: "any",
  state: "open",
  search: "",
};

// Every filter off but the state.
const clearedIn = (state: PrState): PrFilters => ({
  author: "anyone",
  reviewRequested: false,
  draft: "any",
  walkthrough: "any",
  state,
  search: "",
});

// The buttons over the page's filters, each setting whose PRs show.
export type Preset = "mine" | "reviewRequested" | "others" | "all";

const PRESETS: Record<
  Preset,
  Pick<PrFilters, "author" | "reviewRequested"> & { readonly label: string }
> = {
  mine: { label: "Mine", author: "me", reviewRequested: false },
  reviewRequested: {
    label: "Review requested",
    author: "anyone",
    reviewRequested: true,
  },
  others: { label: "Others'", author: "others", reviewRequested: false },
  all: { label: "All", author: "anyone", reviewRequested: false },
};

// The presets, in the order the page shows them.
export const presets = (
  ["mine", "reviewRequested", "others", "all"] satisfies Array<Preset>
).map((preset) => ({ preset, label: PRESETS[preset].label }));

// The filters with a preset pressed: it sets the author and review-requested filters, and leaves
// the draft, state and search filters as they were.
export const withPreset = (filters: PrFilters, preset: Preset): PrFilters => ({
  ...filters,
  author: PRESETS[preset].author,
  reviewRequested: PRESETS[preset].reviewRequested,
});

// The preset the filters are on: none once the author or review-requested filter is set some other
// way.
export const presetOf = (filters: PrFilters): Preset | undefined =>
  presets.find(
    ({ preset }) =>
      PRESETS[preset].author === filters.author &&
      PRESETS[preset].reviewRequested === filters.reviewRequested,
  )?.preset;

// What to ask GitHub for to show the PRs in the filters' state: closed and merged PRs come
// together, so telling them apart never asks again.
export const listStateOf = (filters: PrFilters): PrListState =>
  filters.state === "open" ? "open" : "closed";

const allPrs = (list: PullRequestList) => [
  ...list.stacks.flatMap((s) => s.prs),
  ...list.lone,
];

// GitHub logins are the same whatever their case.
const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// One way the author filter can be set, with a `value` naming it among the others.
export interface AuthorChoice {
  readonly value: string;
  readonly label: string;
  readonly author: AuthorFilter;
}

// What the author filter offers: anyone, the developer, everyone else, then each other author with
// a PR in the list, by login, once each. A login picked before stays offered once its PRs are gone.
// Before the list is fetched, only the first three.
export const authorChoices = (
  list: PullRequestList | undefined,
  filters: PrFilters,
): ReadonlyArray<AuthorChoice> => {
  const picked =
    typeof filters.author === "object" ? [filters.author.login] : [];
  const listed = list === undefined ? [] : allPrs(list);
  const logins = [
    ...new Map(
      [...picked, ...listed.map((pr) => pr.author)]
        .filter(
          (author) => list === undefined || !sameLogin(author, list.login),
        )
        .map((author) => [author.toLowerCase(), author]),
    ).values(),
  ].toSorted((a, b) => a.localeCompare(b));
  return [
    { value: "anyone", label: "Anyone", author: "anyone" },
    { value: "me", label: "Me", author: "me" },
    { value: "others", label: "Not me", author: "others" },
    ...logins.map((login) => ({
      value: `@${login}`,
      label: login,
      author: { login },
    })),
  ];
};

// The choice the author filter is on.
export const authorValueOf = (filters: PrFilters): string =>
  typeof filters.author === "object"
    ? `@${filters.author.login}`
    : filters.author;

const byAuthor = (pr: ListedPullRequest, author: AuthorFilter, me: string) => {
  if (author === "anyone") return true;
  if (author === "me") return sameLogin(pr.author, me);
  if (author === "others") return !sameLogin(pr.author, me);
  return sameLogin(pr.author, author.login);
};

const byDraft = (pr: ListedPullRequest, draft: DraftFilter) =>
  draft === "any" || pr.draft === (draft === "draft");

// Whether a search finds the PR: in its title or branch, whatever the case, or by its number's
// first digits, with or without a `#`.
const found = (pr: ListedPullRequest, search: string) => {
  const words = search.trim().toLowerCase();
  if (words === "") return true;
  const digits = /^#?(\d+)$/.exec(words)?.[1];
  if (digits !== undefined && String(pr.number).startsWith(digits)) return true;
  return (
    pr.title.toLowerCase().includes(words) ||
    pr.headRef.toLowerCase().includes(words)
  );
};

const byWalkthrough = (
  pr: ListedPullRequest,
  walkthrough: WalkthroughFilter,
  live: LiveWalkthroughs | undefined,
) =>
  walkthrough === "any" ||
  foreignPrStateOf(pr, walkthroughOf(pr, live)) === walkthrough;

const passes = (
  pr: ListedPullRequest,
  filters: PrFilters,
  me: string,
  live: LiveWalkthroughs | undefined,
) =>
  pr.state === filters.state &&
  byAuthor(pr, filters.author, me) &&
  (!filters.reviewRequested || pr.reviewRequested) &&
  byDraft(pr, filters.draft) &&
  byWalkthrough(pr, filters.walkthrough, live) &&
  found(pr, filters.search);

// A PR as the page lists it: dimmed when it's shown only for the Stack it's in.
export interface PrRow {
  readonly pr: ListedPullRequest;
  readonly dimmed: boolean;
}

// A Stack as the page lists it: whole, bottom first, when any of its PRs passes the filters.
export interface StackRow {
  readonly stack: ListedStack;
  readonly prs: ReadonlyArray<PrRow>;
}

// What the page says in place of an empty list, and the filters that would show something, when
// some would.
export interface EmptyList {
  readonly text: string;
  readonly clear?: PrFilters;
}

// What the page shows of the fetched PRs under the filters.
export interface PrRows {
  readonly stacks: ReadonlyArray<StackRow>;
  // The PRs in no Stack that pass the filters.
  readonly lone: ReadonlyArray<ListedPullRequest>;
  // Set when nothing shows.
  readonly empty?: EmptyList;
}

// Why nothing shows: GitHub has no PRs in the state, or the filters hide those it has. Clearing
// the filters keeps the state while it has PRs, and goes back to the open PRs when it has none.
const emptiness = (
  list: PullRequestList,
  filters: PrFilters,
): EmptyList | undefined => {
  const inState = allPrs(list).some((pr) => pr.state === filters.state);
  if (inState)
    return {
      text: "No pull requests match these filters.",
      clear: clearedIn(filters.state),
    };
  const text = `No ${filters.state} pull requests.`;
  return filters.state === "open"
    ? { text }
    : { text, clear: clearedIn("open") };
};

// The Walkthrough filter goes by each Foreign PR's Walkthrough as it stands now, `live`, once
// that's known.
export const rowsOf = (
  list: PullRequestList,
  filters: PrFilters,
  live?: LiveWalkthroughs,
): PrRows => {
  const shows = (pr: ListedPullRequest) =>
    passes(pr, filters, list.login, live);
  const stacks = list.stacks.flatMap((stack) =>
    stack.prs.some(shows)
      ? [{ stack, prs: stack.prs.map((pr) => ({ pr, dimmed: !shows(pr) })) }]
      : [],
  );
  const lone = list.lone.filter(shows);
  return stacks.length === 0 && lone.length === 0
    ? { stacks, lone, empty: emptiness(list, filters) }
    : { stacks, lone };
};
