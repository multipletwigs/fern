import { Context, Duration, Effect, Layer, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

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

// How long Fern waits on `gh` to say whether it's ready, as `gh auth status` asks GitHub.
export const CodeHostReadyTimeout = Context.Reference<Duration.Input>(
  "@repo/server/codehost/CodeHostReadyTimeout",
  { defaultValue: () => "10 seconds" },
);

// How long one push or PR change may take before Fern gives up on it.
const CALL_TIMEOUT = Duration.minutes(2);
// How long merging a Stack may take: GitHub merges it in the background while gh-stack waits.
const MERGE_TIMEOUT = Duration.minutes(10);
// The REST API version GitHub's Stacks are in.
const STACKS_API = "X-GitHub-Api-Version: 2026-03-10";

// The PR's number at the end of the URL `gh pr create` prints, e.g. ".../pull/123".
const PR_URL = /https:\/\/\S+\/pull\/(\d+)/;

// The Stacks GitHub has for a PR: at most the one it's in.
const StacksOfPr = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ number: Schema.Int })),
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
    // Whether Fern can put a Stack up from the folder: `gh` signed in, with gh-stack installed.
    // Never fails: a code host that can't be asked isn't ready.
    ready(cwd: string): Effect.Effect<boolean>;
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

      const ready = Effect.fn("CodeHost.ready")(function* (cwd: string) {
        const timeout = yield* CodeHostReadyTimeout;
        return yield* Effect.all(
          [
            run(cwd, "gh", ["auth", "status"]),
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

      return CodeHost.of({
        ready,
        push,
        openDraft,
        link,
        setBody,
        markReady,
        merge,
        state,
      });
    }),
  );
}
