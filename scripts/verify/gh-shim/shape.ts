// The shim's fixtures. `FixtureSource` is what a fixture file says (fixture.json is the default);
// `verify:up` makes each PR's commits from its `edits` and writes the `Fixture` the shim serves.

type GhState = "OPEN" | "CLOSED" | "MERGED";

// A file the PR adds or replaces whole (`content`), or adds lines to the end of (`append`).
export type Edit =
  | { readonly path: string; readonly content: string }
  | { readonly path: string; readonly append: string };

interface ReviewSource {
  readonly login: string;
  readonly state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";
  readonly body: string;
}

interface PrSource {
  readonly number: number;
  readonly title: string;
  readonly author: string;
  // Its branch, and the branch it merges into: the default branch or another PR's `head`.
  readonly head: string;
  readonly base: string;
  readonly state?: GhState;
  readonly draft?: boolean;
  // The logins asked to review it.
  readonly reviewers?: ReadonlyArray<string>;
  readonly body: string;
  // The numbers of the issues it says it closes.
  readonly closes?: ReadonlyArray<number>;
  readonly edits: ReadonlyArray<Edit>;
  readonly reviews?: ReadonlyArray<ReviewSource>;
}

export interface FixtureSource {
  // Who `gh` is signed in as.
  readonly login: string;
  readonly defaultBranch: string;
  readonly issues?: ReadonlyArray<{
    readonly number: number;
    readonly title: string;
    readonly body: string;
  }>;
  // The repo's Stacks, each PR's number bottom first. None: the repo has no Stacks, a 404.
  readonly stacks?: ReadonlyArray<{
    readonly id: number;
    readonly number: number;
    readonly prs: ReadonlyArray<number>;
  }>;
  readonly prs: ReadonlyArray<PrSource>;
}

export interface Review extends ReviewSource {
  readonly id: number;
  readonly commit: string;
  readonly url: string;
  readonly submittedAt: string;
}

export interface Pr extends Omit<PrSource, "edits" | "reviews"> {
  readonly state: GhState;
  readonly draft: boolean;
  readonly reviewers: ReadonlyArray<string>;
  readonly closes: ReadonlyArray<number>;
  readonly url: string;
  readonly headCommit: string;
  readonly baseCommit: string;
  // Its diff as GitHub shows it: each file's hunks.
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly patch: string;
  }>;
  readonly reviews: ReadonlyArray<Review>;
}

export interface Fixture extends Omit<FixtureSource, "prs"> {
  // "owner/name", from the worktree's `origin`.
  readonly repo: string;
  readonly prs: ReadonlyArray<Pr>;
}
