import {
  type DiffSide,
  GhPrState,
  type PrListState,
  type PrReviewEvent,
  type PrState,
} from "@repo/api";
import {
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

// A branch name Fern can pass to git and `gh` as it is: no leading dash, nothing git refuses in a
// ref, and no longer than GitHub allows.
export const BranchName = Schema.String.check(
  Schema.isPattern(
    /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*\/$)[A-Za-z0-9._/-]{1,255}$/,
  ),
);

export class CodeHostError extends Schema.TaggedError<CodeHostError>()(
  "CodeHostError",
  { message: Schema.String },
) {}

// GitHub refused to merge the Stack, with why in plain words: failing checks, a review it still
// needs, conflicts with a `main` that moved on. Fern never merges around it.
export class MergeRefused extends Schema.TaggedError<MergeRefused>()(
  "MergeRefused",
  { reason: Schema.String },
) {}

// A PR Fern opened on the code host.
export interface OpenedPullRequest {
  readonly number: number;
  readonly url: string;
}

// A PR on the repo, as GitHub lists it.
export interface HostPullRequest {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  // The login of whoever opened it.
  readonly author: string;
  readonly headRef: string;
  readonly baseRef: string;
  readonly headCommit: string;
  readonly draft: boolean;
  readonly state: PrState;
  // The logins of the people asked to review it. Teams asked are left out.
  readonly reviewers: ReadonlyArray<string>;
}

// The issue a PR says it closes.
export interface HostIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
}

// One PR, as GitHub has it: also its author's description of it, and where the first issue it
// says it closes is, when it names one Fern can read.
export interface HostPullRequestDetail extends HostPullRequest {
  readonly body: string;
  // The issue's URL, for `issue`.
  readonly closes: string | undefined;
}

// A review to post on a PR: on which of its commits, what it says of the PR, its body, and notes on
// single lines of the PR's diff.
export interface HostReview {
  readonly commit: string;
  readonly event: PrReviewEvent;
  readonly body: string;
  readonly comments: ReadonlyArray<{
    readonly path: string;
    readonly line: number;
    readonly side: DiffSide;
    readonly body: string;
  }>;
}

// One file of a PR's diff, as GitHub shows it: by its path in the PR, a renamed file by its new
// one, and the hunks of its patch, none where GitHub shows none, as for a binary or a large file.
export interface HostPrFile {
  readonly path: string;
  readonly patch: string | undefined;
}

// A review that went up: where it is, and when GitHub took it, in milliseconds.
export interface HostPostedReview {
  readonly url: string;
  readonly postedAt: number;
}

// A Stack on the repo, as GitHub has it: its PRs' numbers, bottom first, open or not.
export interface HostStack {
  readonly id: number;
  readonly number: number;
  readonly prs: ReadonlyArray<number>;
}

// How long Fern waits on `gh` to say whether it's ready, as `gh auth status` asks GitHub.
export const CodeHostReadyTimeout = Context.Reference<Duration.Input>(
  "@repo/server/codehost/CodeHostReadyTimeout",
  { defaultValue: () => "10 seconds" },
);

// How long one push or PR change may take before Fern gives up on it.
const CALL_TIMEOUT = Duration.minutes(2);

// How long posting a review may take before Fern stops waiting and asks GitHub whether it took it.
export const CodeHostPostTimeout = Context.Reference<Duration.Input>(
  "@repo/server/codehost/CodeHostPostTimeout",
  { defaultValue: () => CALL_TIMEOUT },
);
// How long merging a Stack may take: GitHub merges it in the background while gh-stack waits.
const MERGE_TIMEOUT = Duration.minutes(10);
// The REST API version GitHub's Stacks are in.
const STACKS_API = "X-GitHub-Api-Version: 2026-03-10";

// How long listing the repo's PRs or Stacks may take: the Pull requests page waits on it.
const LIST_TIMEOUT = Duration.seconds(30);
// The most open PRs Fern lists of a repo.
const MAX_LISTED = 200;
// How many Stacks GitHub sends a page, at most, and how many pages Fern reads looking for a PR's.
const STACKS_PER_PAGE = 100;
const MAX_STACK_PAGES = 5;

// The PR's number at the end of the URL `gh pr create` prints, e.g. ".../pull/123".
const PR_URL = /https:\/\/\S+\/pull\/(\d+)/;

// The Stacks GitHub has for a PR: at most the one it's in. Its number goes to gh-stack as an
// argument, so it's a positive whole number, never anything `gh` could read as a flag.
const StacksOfPr = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({ number: Schema.Int.check(Schema.isGreaterThan(0)) }),
  ),
);
// The repo's open PRs, as `gh pr list` has them. A reviewer asked is a person, with a login, or a
// team, without one.
const PR_FIELDS =
  "number,url,title,author,headRefName,baseRefName,headRefOid,isDraft,state,reviewRequests";
const GhPr = Schema.Struct({
  number: Schema.Int,
  url: Schema.String,
  title: Schema.String,
  author: Schema.NullOr(Schema.Struct({ login: Schema.String })),
  headRefName: Schema.String,
  baseRefName: Schema.String,
  headRefOid: Schema.String,
  isDraft: Schema.Boolean,
  state: GhPrState,
  reviewRequests: Schema.Array(
    Schema.Struct({ login: Schema.optional(Schema.String) }),
  ),
});
const ListedPrs = Schema.fromJsonString(Schema.Array(GhPr));
// One PR as `gh pr view` has it: also its description, and the issues it says it closes.
const ViewedPr = Schema.fromJsonString(
  Schema.Struct({
    ...GhPr.fields,
    body: Schema.String,
    closingIssuesReferences: Schema.Array(
      Schema.Struct({ number: Schema.Int, url: Schema.String }),
    ),
  }),
);
// An issue as `gh issue view` has it.
const ViewedIssue = Schema.fromJsonString(
  Schema.Struct({
    number: Schema.Int,
    title: Schema.String,
    body: Schema.String,
  }),
);
const PR_STATE: Record<GhPrState, PrState> = {
  OPEN: "open",
  CLOSED: "closed",
  MERGED: "merged",
};
const hostPr = (pr: typeof GhPr.Type): HostPullRequest => ({
  number: pr.number,
  url: pr.url,
  title: pr.title,
  author: pr.author?.login ?? "ghost",
  headRef: pr.headRefName,
  baseRef: pr.baseRefName,
  headCommit: pr.headRefOid,
  draft: pr.isDraft,
  state: PR_STATE[pr.state],
  reviewers: pr.reviewRequests.flatMap((r) =>
    r.login === undefined ? [] : [r.login],
  ),
});

// Where Fern keeps a PR's head, and the branch it's based on, once fetched: hidden refs in the
// Project's own repo, which nothing pushes, never a branch the developer has.
export const prHeadRef = (number: number) => `refs/fern/prs/${number}/head`;
export const prBaseRef = (number: number) => `refs/fern/prs/${number}/base`;
// One page of the repo's Stacks, as GitHub's REST API has them.
const StacksPage = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      id: Schema.Int,
      number: Schema.Int,
      pull_requests: Schema.Array(Schema.Struct({ number: Schema.Int })),
    }),
  ),
);
// One of a PR's files, as Fern asks `gh api` to print each: on a line of its own.
const PrFile = Schema.fromJsonString(
  Schema.Struct({
    path: Schema.String,
    patch: Schema.optional(Schema.NullOr(Schema.String)),
  }),
);
// One of a PR's reviews, as Fern asks `gh api` to print each: on a line of its own.
const ReviewOnPr = Schema.fromJsonString(
  Schema.Struct({
    login: Schema.NullOr(Schema.String),
    commit: Schema.NullOr(Schema.String),
    body: Schema.NullOr(Schema.String),
    url: Schema.String,
    at: Schema.NullOr(Schema.String),
  }),
);
// A review GitHub took, as its REST API has it.
const PostedPrReview = Schema.fromJsonString(
  Schema.Struct({ html_url: Schema.String, submitted_at: Schema.String }),
);
// Why GitHub's REST API refused a call, as `gh api` prints its answer: a message, and sometimes
// more particular errors, as sentences or objects with a message.
const RestRefusal = Schema.fromJsonString(
  Schema.Struct({
    message: Schema.String,
    status: Schema.optional(Schema.Union([Schema.String, Schema.Finite])),
    errors: Schema.optional(
      Schema.Array(
        Schema.Union([
          Schema.String,
          Schema.Struct({ message: Schema.optional(Schema.String) }),
        ]),
      ),
    ),
  }),
);
// Whether GitHub surely refused the call, saying so: not when it gave no answer Fern can read, or
// failed on its side, which it may have done after taking it.
const refusedSurely = (stdout: string) =>
  Option.match(Schema.decodeOption(RestRefusal)(stdout.trim()), {
    onNone: () => false,
    onSome: (answer) => !String(answer.status ?? "").startsWith("5"),
  });

// GitHub's reason for refusing, in plain words: its particular errors when it gave some, else its
// message, else what `gh` said.
const refusalOf = (stdout: string, stderr: string, exitCode: number) => {
  const answer = Option.getOrUndefined(
    Schema.decodeOption(RestRefusal)(stdout.trim()),
  );
  if (answer === undefined)
    return (
      plainly(stderr.replace(/^gh:\s*/gmu, "")) ||
      `GitHub refused (gh exit ${exitCode}).`
    );
  const particular = (answer.errors ?? []).flatMap((e) =>
    typeof e === "string" ? [e] : e.message === undefined ? [] : [e.message],
  );
  return particular.length > 0
    ? particular.map(sentence).join(" ")
    : sentence(answer.message);
};

// A GitHub login, as `gh api user` prints it.
const Login = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9[\]-]{1,64}$/));

// A commit id, in full or abbreviated: nothing else goes into a compare.
const CommitId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{7,64}$/));

// The repo's default branch, as `gh repo view` has it.
const RepoView = Schema.fromJsonString(
  Schema.Struct({ defaultBranchRef: Schema.Struct({ name: BranchName }) }),
);
// Whether a PR merged, as GitHub's REST API has it.
const PrMerge = Schema.fromJsonString(
  Schema.Struct({ merged_at: Schema.NullOr(Schema.String) }),
);
// What stops a PR from merging, as `gh pr view` has it.
const PrBlockers = Schema.fromJsonString(
  Schema.Struct({
    mergeStateStatus: Schema.optional(Schema.String),
    mergeable: Schema.optional(Schema.String),
    reviewDecision: Schema.optional(Schema.NullOr(Schema.String)),
  }),
);

// A line as a sentence: capitalised, and ending in a full stop.
const sentence = (line: string) =>
  `${line.charAt(0).toUpperCase()}${line.slice(1)}${/[.!?]$/u.test(line) ? "" : "."}`;

// What `gh` printed when it refused, as sentences: without its marks and prefixes.
const plainly = (printed: string) =>
  printed
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(?:✗|X|!)\s+/u, "")
        .replace(/^(?:GraphQL|HTTP \d+):\s*/u, "")
        .trim(),
    )
    .filter((line) => line !== "")
    .map(sentence)
    .join(" ");

// Why GitHub won't merge the PR, in plain words, from what `gh pr view` says stops it.
const blockersOf = (
  pr: number,
  { mergeStateStatus, mergeable, reviewDecision }: typeof PrBlockers.Type,
): ReadonlyArray<string> => [
  ...(mergeable === "CONFLICTING" || mergeStateStatus === "DIRTY"
    ? [`PR #${pr} has conflicts with the branch it merges into.`]
    : mergeStateStatus === "BEHIND"
      ? [`PR #${pr} is behind the branch it merges into.`]
      : []),
  ...(reviewDecision === "REVIEW_REQUIRED"
    ? [`PR #${pr} needs an approving review.`]
    : reviewDecision === "CHANGES_REQUESTED"
      ? [`A reviewer asked for changes on PR #${pr}.`]
      : []),
  ...(mergeStateStatus === "UNSTABLE"
    ? [`PR #${pr} has failing checks.`]
    : mergeStateStatus === "BLOCKED" && reviewDecision !== "REVIEW_REQUIRED"
      ? [
          `PR #${pr} is blocked by the repository's rules, such as checks they require.`,
        ]
      : []),
];

// What `gh` printed, read as the schema says, or why Fern can't.
const read = <S extends Schema.Codec<unknown, string>>(
  schema: S,
  what: string,
) =>
  Effect.flatMap((out: string) =>
    Schema.decodeEffect(schema)(out).pipe(
      Effect.mapError(
        () =>
          new CodeHostError({
            message: `GitHub's ${what} aren't as Fern expects.`,
          }),
      ),
    ),
  );

// A review that went up, at its URL, when GitHub says it took it, or now.
const postedAs = (url: string, at: string | null): HostPostedReview => {
  const postedAt = Date.parse(at ?? "");
  return { url, postedAt: Number.isNaN(postedAt) ? Date.now() : postedAt };
};

// Gives up on a call to GitHub that takes longer than the duration.
const late = (duration: Duration.Duration) =>
  Effect.timeoutOrElse({
    duration,
    orElse: () =>
      Effect.fail(
        new CodeHostError({ message: "GitHub didn't answer in time" }),
      ),
  });

// The code host of the repository a folder is in, where a Hosted Session's Stack goes up (ADR
// 0009). The live one is GitHub, through the `gh` CLI and its gh-stack extension, run in the folder
// so both find the repository from its `origin`. Fern itself checks that `origin` is on GitHub
// before asking anything here.
export class CodeHost extends Context.Service<
  CodeHost,
  {
    // Whether Fern can put a Stack up from the folder: `gh` signed in to github.com, with gh-stack
    // installed. Never fails: a code host that can't be asked isn't ready.
    ready(cwd: string): Effect.Effect<boolean>;
    // The repository's default branch on the code host, which every Stack is based on.
    defaultBranch(cwd: string): Effect.Effect<string, CodeHostError>;
    // Points the branch on `origin` at the commit, creating it if needed. Needs no local branch.
    // With `replacing`, moves the branch from that commit, and only from it.
    push(
      cwd: string,
      push: {
        readonly commit: string;
        readonly branch: string;
        readonly replacing?: string;
      },
    ): Effect.Effect<void, CodeHostError>;
    // Opens a draft PR merging `head` into `base`, both branches already on `origin`.
    openDraft(
      cwd: string,
      pr: {
        readonly head: string;
        readonly base: string;
        readonly title: string;
        readonly body: string;
      },
    ): Effect.Effect<OpenedPullRequest, CodeHostError>;
    // Makes the PRs, at least two, bottom first, one Stack: creates it, or adds the ones not in it
    // yet to its top. Each PR's base is already the head of the one below.
    link(
      cwd: string,
      prs: ReadonlyArray<OpenedPullRequest>,
    ): Effect.Effect<void, CodeHostError>;
    // Replaces the PR's description.
    setBody(
      cwd: string,
      pr: number,
      body: string,
    ): Effect.Effect<void, CodeHostError>;
    // Takes the PRs out of draft, so they can merge.
    markReady(
      cwd: string,
      prs: ReadonlyArray<OpenedPullRequest>,
    ): Effect.Effect<void, CodeHostError>;
    // Squash-merges the Stack, its PRs given bottom first, all at once, as the repository's rules
    // allow: never around them. A Stack of one PR is just that PR, merged on its own.
    merge(
      cwd: string,
      prs: ReadonlyArray<OpenedPullRequest>,
    ): Effect.Effect<void, MergeRefused | CodeHostError>;
    // Where the Stack stands: merged once every one of its PRs has.
    state(
      cwd: string,
      prs: ReadonlyArray<OpenedPullRequest>,
    ): Effect.Effect<{ readonly merged: boolean }, CodeHostError>;
    // The GitHub login `gh` is signed in as.
    login(cwd: string): Effect.Effect<string, CodeHostError>;
    // The repo's PRs in one `state`, newest first: the open ones, or the closed ones with the merged
    // ones. Fails with GitHub's reason, in plain words.
    pullRequests(
      cwd: string,
      state: PrListState,
    ): Effect.Effect<ReadonlyArray<HostPullRequest>, CodeHostError>;
    // The repo's Stacks, newest first: as many of them as it takes to find each of the PRs, when
    // GitHub has a Stack holding it, up to a few hundred. None where the repo has no Stacks.
    stacks(
      cwd: string,
      prs: ReadonlyArray<number>,
    ): Effect.Effect<ReadonlyArray<HostStack>, CodeHostError>;
    // One of the repo's PRs, open or not, with its description. Fails with GitHub's reason, in
    // plain words, as for a number that isn't a PR.
    pullRequest(
      cwd: string,
      pr: number,
    ): Effect.Effect<HostPullRequestDetail, CodeHostError>;
    // The issue at the URL a PR `closes`. None where GitHub won't say.
    issue(cwd: string, url: string): Effect.Effect<HostIssue | undefined>;
    // Fetches the PR's head, as GitHub keeps it for any PR, a fork's included, and the branch it's
    // based on, into `prHeadRef` and `prBaseRef`. Touches no branch, the index or the working tree.
    fetchPullRequest(
      cwd: string,
      pr: { readonly number: number; readonly base: string },
    ): Effect.Effect<void, CodeHostError>;
    // How many commits `to` has that `from` doesn't, as GitHub compares the two, so it needs
    // neither fetched. Both are commit ids.
    commitsAhead(
      cwd: string,
      commits: { readonly from: string; readonly to: string },
    ): Effect.Effect<number, CodeHostError>;
    // The PR's diff as GitHub shows it at the PR's head, which a review's comments go on.
    pullRequestDiff(
      cwd: string,
      pr: number,
    ): Effect.Effect<ReadonlyArray<HostPrFile>, CodeHostError>;
    // Posts the review on the PR, in one call: its body and its line comments together, or none of
    // it. Fails with GitHub's reason, in plain words, as for a comment on a line the PR doesn't
    // change, or approving one's own PR.
    postReview(
      cwd: string,
      pr: number,
      review: HostReview,
    ): Effect.Effect<HostPostedReview, CodeHostError>;
  }
>()("@repo/server/codehost/CodeHost") {
  static readonly layer = Layer.effect(
    CodeHost,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      // Runs the command in the folder, to the end: what it printed, and how it exited.
      const exec = Effect.fn("CodeHost.exec")(
        function* (
          cwd: string,
          command: string,
          args: ReadonlyArray<string>,
          input?: string,
        ) {
          const handle = yield* spawner.spawn(
            ChildProcess.make(command, args, {
              cwd,
              extendEnv: true,
              stdin:
                input === undefined
                  ? "ignore"
                  : { stream: Stream.make(new TextEncoder().encode(input)) },
            }),
          );
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
              handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
              handle.exitCode,
            ],
            { concurrency: "unbounded" },
          );
          return { stdout, stderr, exitCode };
        },
        Effect.scoped,
        Effect.catchTag("PlatformError", (cause) =>
          Effect.fail(new CodeHostError({ message: cause.message })),
        ),
      );
      // Runs the command in the folder, returning what it printed; fails with its stderr when it
      // exits non-zero.
      const run = Effect.fn("CodeHost.run")(function* (
        cwd: string,
        command: string,
        args: ReadonlyArray<string>,
        input?: string,
      ) {
        const { stdout, stderr, exitCode } = yield* exec(
          cwd,
          command,
          args,
          input,
        );
        const line = [command, ...args.slice(0, 2)].join(" ");
        if (exitCode !== 0)
          return yield* new CodeHostError({
            message: `${line}: ${stderr.trim() || `exit ${exitCode}`}`,
          });
        return stdout;
      }, late(CALL_TIMEOUT));

      // Asks `gh`, returning what it printed; fails with what it said, in plain words, when it
      // refuses.
      const ask = Effect.fn("CodeHost.ask")(function* (
        cwd: string,
        args: ReadonlyArray<string>,
      ) {
        const { stdout, stderr, exitCode } = yield* exec(cwd, "gh", args);
        if (exitCode !== 0)
          return yield* new CodeHostError({
            message: plainly(stderr) || `GitHub refused (gh exit ${exitCode}).`,
          });
        return stdout;
      }, late(LIST_TIMEOUT));

      const ready = Effect.fn("CodeHost.ready")(function* (cwd: string) {
        const timeout = yield* CodeHostReadyTimeout;
        return yield* Effect.all(
          [
            // Only the host every Stack is on: a stale login to another host fails a bare
            // `gh auth status`, though `gh` works on github.com.
            run(cwd, "gh", ["auth", "status", "--hostname", "github.com"]),
            run(cwd, "gh", ["stack", "--version"]),
          ],
          { concurrency: "unbounded" },
        ).pipe(
          Effect.as(true),
          Effect.timeoutOrElse({
            duration: timeout,
            orElse: () => Effect.succeed(false),
          }),
          Effect.orElseSucceed(() => false),
        );
      });

      const defaultBranch = Effect.fn("CodeHost.defaultBranch")(function* (
        cwd: string,
      ) {
        const out = yield* run(cwd, "gh", [
          "repo",
          "view",
          "--json",
          "defaultBranchRef",
        ]);
        const view = yield* Schema.decodeEffect(RepoView)(out).pipe(
          Effect.mapError(
            () =>
              new CodeHostError({
                message: `GitHub's default branch isn't one Fern can use: ${out.trim()}`,
              }),
          ),
        );
        return view.defaultBranchRef.name;
      });

      const push = Effect.fn("CodeHost.push")(function* (
        cwd: string,
        {
          commit,
          branch,
          replacing,
        }: {
          readonly commit: string;
          readonly branch: string;
          readonly replacing?: string;
        },
      ) {
        yield* run(cwd, "git", [
          "push",
          "--quiet",
          ...(replacing === undefined
            ? []
            : [`--force-with-lease=refs/heads/${branch}:${replacing}`]),
          "origin",
          `${commit}:refs/heads/${branch}`,
        ]);
      });

      const openDraft = Effect.fn("CodeHost.openDraft")(function* (
        cwd: string,
        pr: {
          readonly head: string;
          readonly base: string;
          readonly title: string;
          readonly body: string;
        },
      ) {
        const out = yield* run(
          cwd,
          "gh",
          [
            "pr",
            "create",
            "--draft",
            "--base",
            pr.base,
            "--head",
            pr.head,
            "--title",
            pr.title,
            "--body-file",
            "-",
          ],
          pr.body,
        );
        const found = PR_URL.exec(out);
        if (!found?.[1])
          return yield* new CodeHostError({
            message: `gh pr create printed no PR: ${out.trim()}`,
          });
        return { number: Number(found[1]), url: found[0] };
      });

      // By URL, as gh-stack reads a first argument that's a number as a Stack's when there's one.
      const link = Effect.fn("CodeHost.link")(function* (
        cwd: string,
        prs: ReadonlyArray<OpenedPullRequest>,
      ) {
        yield* run(cwd, "gh", ["stack", "link", ...prs.map((pr) => pr.url)]);
      });

      const setBody = Effect.fn("CodeHost.setBody")(function* (
        cwd: string,
        pr: number,
        body: string,
      ) {
        yield* run(
          cwd,
          "gh",
          ["pr", "edit", String(pr), "--body-file", "-"],
          body,
        );
      });

      const markReady = Effect.fn("CodeHost.markReady")(function* (
        cwd: string,
        prs: ReadonlyArray<OpenedPullRequest>,
      ) {
        for (const pr of prs)
          yield* run(cwd, "gh", ["pr", "ready", String(pr.number)]);
      });

      // The number of the Stack the PR is in, which `gh stack merge` takes.
      const stackOf = Effect.fn("CodeHost.stackOf")(function* (
        cwd: string,
        pr: number,
      ) {
        const out = yield* run(cwd, "gh", [
          "api",
          "-H",
          STACKS_API,
          `repos/{owner}/{repo}/stacks?pull_request=${pr}`,
        ]);
        const [stack] = yield* Schema.decodeEffect(StacksOfPr)(out).pipe(
          Effect.mapError(
            () => new CodeHostError({ message: `GitHub's Stacks: ${out}` }),
          ),
        );
        if (!stack)
          return yield* new CodeHostError({
            message: `PR #${pr} isn't in a Stack on GitHub.`,
          });
        return stack.number;
      });

      // What stops each PR from merging, in plain words; nothing where `gh` can't say.
      const blockers = (cwd: string, prs: ReadonlyArray<OpenedPullRequest>) =>
        Effect.forEach(prs, (pr) =>
          run(cwd, "gh", [
            "pr",
            "view",
            String(pr.number),
            "--json",
            "mergeStateStatus,mergeable,reviewDecision",
          ]).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(PrBlockers)),
            Effect.map((found) => blockersOf(pr.number, found)),
            Effect.orElseSucceed((): ReadonlyArray<string> => []),
          ),
        ).pipe(Effect.map((all) => all.flat()));

      // `gh stack merge` takes no PR outside a Stack, so a Stack of one PR merges through
      // `gh pr merge`. Neither is ever given `--admin` or `--auto`.
      const merge = Effect.fn("CodeHost.merge")(function* (
        cwd: string,
        prs: ReadonlyArray<OpenedPullRequest>,
      ) {
        const [bottom] = prs;
        if (!bottom) return yield* Effect.void;
        const args =
          prs.length === 1
            ? ["pr", "merge", String(bottom.number), "--squash"]
            : [
                "stack",
                "merge",
                String(yield* stackOf(cwd, bottom.number)),
                "--squash",
                "--yes",
              ];
        const { stdout, stderr, exitCode } = yield* exec(cwd, "gh", args);
        if (exitCode === 0) return yield* Effect.void;
        const said = plainly(stderr) || plainly(stdout);
        const why = yield* blockers(cwd, prs);
        return yield* new MergeRefused({
          reason:
            [said, ...why].join(" ") ||
            `GitHub refused the merge (exit ${exitCode}).`,
        });
      }, late(MERGE_TIMEOUT));

      const state = Effect.fn("CodeHost.state")(function* (
        cwd: string,
        prs: ReadonlyArray<OpenedPullRequest>,
      ) {
        const merges = yield* Effect.forEach(prs, (pr) =>
          run(cwd, "gh", [
            "api",
            `repos/{owner}/{repo}/pulls/${pr.number}`,
          ]).pipe(
            Effect.flatMap((out) =>
              Schema.decodeEffect(PrMerge)(out).pipe(
                Effect.mapError(
                  () =>
                    new CodeHostError({
                      message: `GitHub's PR #${pr.number} isn't as Fern expects.`,
                    }),
                ),
              ),
            ),
          ),
        );
        return {
          merged:
            merges.length > 0 && merges.every((pr) => pr.merged_at !== null),
        };
      });

      const login = Effect.fn("CodeHost.login")(function* (cwd: string) {
        const out = yield* ask(cwd, ["api", "user", "--jq", ".login"]);
        return yield* Schema.decodeEffect(Login)(out.trim()).pipe(
          Effect.mapError(
            () =>
              new CodeHostError({
                message: "GitHub's login isn't one Fern can read.",
              }),
          ),
        );
      });

      const pullRequests = Effect.fn("CodeHost.pullRequests")(function* (
        cwd: string,
        which: PrListState,
      ) {
        const listed = yield* ask(cwd, [
          "pr",
          "list",
          "--state",
          which,
          "--limit",
          String(MAX_LISTED),
          "--json",
          PR_FIELDS,
        ]).pipe(read(ListedPrs, "PRs"));
        return listed.map(hostPr);
      });

      // By its URL, which `pullRequest` only gives for an issue on the PR's own repo.
      const issue = (cwd: string, url: string) =>
        ask(cwd, ["issue", "view", url, "--json", "number,title,body"]).pipe(
          read(ViewedIssue, "issue"),
          Effect.map((found): HostIssue | undefined => found),
          Effect.orElseSucceed(() => undefined),
        );

      const pullRequest = Effect.fn("CodeHost.pullRequest")(function* (
        cwd: string,
        number: number,
      ) {
        const viewed = yield* ask(cwd, [
          "pr",
          "view",
          String(number),
          "--json",
          `${PR_FIELDS},body,closingIssuesReferences`,
        ]).pipe(read(ViewedPr, "PR"));
        // Only an issue on the PR's own repo: one elsewhere could be one only the developer can
        // see, and what's read goes to the writer of a PR anyone could have opened.
        const issues = viewed.url.replace(/\/pull\/\d+$/u, "/issues/");
        const closes = viewed.closingIssuesReferences.find(
          (linked) =>
            linked.url.startsWith(issues) &&
            linked.url.slice(issues.length) === String(linked.number),
        );
        return {
          ...hostPr(viewed),
          body: viewed.body,
          closes: closes?.url,
        };
      });

      // `--no-write-fetch-head`, so fetches of two PRs at once don't race for FETCH_HEAD.
      const fetchPullRequest = Effect.fn("CodeHost.fetchPullRequest")(
        function* (
          cwd: string,
          { number, base }: { readonly number: number; readonly base: string },
        ) {
          if (!Number.isInteger(number) || number <= 0)
            return yield* new CodeHostError({
              message: `#${number} isn't a PR number.`,
            });
          if (!Schema.is(BranchName)(base))
            return yield* new CodeHostError({
              message: `PR #${number}'s base isn't a branch Fern can fetch.`,
            });
          return yield* run(cwd, "git", [
            "fetch",
            "--quiet",
            "--no-tags",
            "--no-write-fetch-head",
            "origin",
            `+refs/pull/${number}/head:${prHeadRef(number)}`,
            `+refs/heads/${base}:${prBaseRef(number)}`,
          ]).pipe(Effect.asVoid);
        },
      );

      // Every page of it, each file on a line of its own.
      const pullRequestDiff = Effect.fn("CodeHost.pullRequestDiff")(function* (
        cwd: string,
        pr: number,
      ) {
        if (!Number.isInteger(pr) || pr <= 0)
          return yield* new CodeHostError({
            message: `#${pr} isn't a PR number.`,
          });
        const out = yield* ask(cwd, [
          "api",
          "--paginate",
          `repos/{owner}/{repo}/pulls/${pr}/files?per_page=100`,
          "--jq",
          ".[] | {path: .filename, patch} | @json",
        ]);
        return yield* Effect.forEach(
          out.split("\n").filter((line) => line.trim() !== ""),
          (line) =>
            Effect.succeed(line).pipe(
              read(PrFile, "PR files"),
              Effect.map((file): HostPrFile => ({
                path: file.path,
                patch: file.patch ?? undefined,
              })),
            ),
        );
      });

      // The review the signed-in developer already has on the PR, on the commit and saying the
      // same, when GitHub has one.
      const postedAlready = Effect.fn("CodeHost.postedAlready")(function* (
        cwd: string,
        pr: number,
        review: HostReview,
      ) {
        const me = (yield* login(cwd)).toLowerCase();
        const out = yield* ask(cwd, [
          "api",
          "--paginate",
          `repos/{owner}/{repo}/pulls/${pr}/reviews?per_page=100`,
          "--jq",
          ".[] | {login: .user.login, commit: .commit_id, body, url: .html_url, at: .submitted_at} | @json",
        ]);
        const said = (body: string | null) =>
          (body ?? "").replaceAll("\r\n", "\n").trim() === review.body.trim();
        for (const line of out.split("\n")) {
          if (line.trim() === "") continue;
          const found = yield* Effect.succeed(line).pipe(
            read(ReviewOnPr, "reviews"),
          );
          if (
            found.login?.toLowerCase() === me &&
            found.commit === review.commit &&
            said(found.body)
          )
            return Option.some(postedAs(found.url, found.at));
        }
        return Option.none<HostPostedReview>();
      });

      // As JSON on stdin, so nothing the review says, the developer's notes and the writer's
      // Section titles included, ever reaches an argument. Once only: GitHub is asked first
      // whether it has the review already, as when Fern stopped before hearing back, and again
      // when the post ends without GitHub surely saying no, as when it took too long to answer.
      const postReview = Effect.fn("CodeHost.postReview")(function* (
        cwd: string,
        pr: number,
        review: HostReview,
      ) {
        if (!Number.isInteger(pr) || pr <= 0)
          return yield* new CodeHostError({
            message: `#${pr} isn't a PR number.`,
          });
        const before = yield* postedAlready(cwd, pr, review);
        if (Option.isSome(before)) return before.value;
        const timeout = yield* CodeHostPostTimeout;
        const sent = yield* exec(
          cwd,
          "gh",
          [
            "api",
            "-X",
            "POST",
            `repos/{owner}/{repo}/pulls/${pr}/reviews`,
            "--input",
            "-",
          ],
          JSON.stringify({
            commit_id: review.commit,
            event: review.event,
            body: review.body,
            comments: review.comments.map((c) => ({
              path: c.path,
              line: c.line,
              side: c.side,
              body: c.body,
            })),
          }),
        ).pipe(Effect.timeoutOption(timeout));
        // GitHub may have taken it all the same.
        const unsure = (error: CodeHostError) =>
          postedAlready(cwd, pr, review).pipe(
            Effect.orElseSucceed(() => Option.none<HostPostedReview>()),
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.fail(error),
                onSome: Effect.succeed,
              }),
            ),
          );
        if (Option.isNone(sent))
          return yield* unsure(
            new CodeHostError({ message: "GitHub didn't answer in time" }),
          );
        const { stdout, stderr, exitCode } = sent.value;
        if (exitCode !== 0) {
          const refused = new CodeHostError({
            message: refusalOf(stdout, stderr, exitCode),
          });
          return yield* refusedSurely(stdout)
            ? Effect.fail(refused)
            : unsure(refused);
        }
        const posted = yield* Effect.succeed(stdout).pipe(
          read(PostedPrReview, "review"),
        );
        return postedAs(posted.html_url, posted.submitted_at);
      });

      // A page at a time, until each PR is found or a page comes back short of full. A repo
      // without Stacks answers 404.
      const stacks = Effect.fn("CodeHost.stacks")(function* (
        cwd: string,
        prs: ReadonlyArray<number>,
      ) {
        const missing = new Set(prs);
        const found: Array<HostStack> = [];
        for (let page = 1; page <= MAX_STACK_PAGES; page++) {
          const { stdout, stderr, exitCode } = yield* exec(cwd, "gh", [
            "api",
            "-H",
            STACKS_API,
            `repos/{owner}/{repo}/stacks?per_page=${STACKS_PER_PAGE}&page=${page}`,
          ]);
          if (exitCode !== 0) {
            if (/HTTP 404/u.test(stderr)) return [];
            return yield* new CodeHostError({
              message:
                plainly(stderr) || `GitHub refused (gh exit ${exitCode}).`,
            });
          }
          const listed = yield* Effect.succeed(stdout).pipe(
            read(StacksPage, "Stacks"),
          );
          for (const stack of listed) {
            const numbers = stack.pull_requests.map((pr) => pr.number);
            for (const number of numbers) missing.delete(number);
            found.push({ id: stack.id, number: stack.number, prs: numbers });
          }
          if (missing.size === 0 || listed.length < STACKS_PER_PAGE) break;
        }
        return found;
      }, late(LIST_TIMEOUT));

      // One commit per page: only the count is read.
      const commitsAhead = Effect.fn("CodeHost.commitsAhead")(function* (
        cwd: string,
        { from, to }: { readonly from: string; readonly to: string },
      ) {
        if (!Schema.is(CommitId)(from) || !Schema.is(CommitId)(to))
          return yield* new CodeHostError({
            message: "Fern compares commits by their ids only.",
          });
        return yield* ask(cwd, [
          "api",
          `repos/{owner}/{repo}/compare/${from}...${to}?per_page=1`,
          "--jq",
          ".ahead_by",
        ]).pipe(
          Effect.map((out) => out.trim()),
          read(Schema.NumberFromString.check(Schema.isInt()), "count"),
        );
      });

      return CodeHost.of({
        ready,
        defaultBranch,
        push,
        openDraft,
        link,
        setBody,
        markReady,
        merge,
        state,
        login,
        pullRequests,
        stacks,
        pullRequest,
        issue,
        fetchPullRequest,
        commitsAhead,
        pullRequestDiff,
        postReview,
      });
    }),
  );
}
