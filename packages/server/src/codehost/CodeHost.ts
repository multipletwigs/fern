import { Context, Duration, Effect, Layer, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export class CodeHostError extends Schema.TaggedError<CodeHostError>()(
  "CodeHostError",
  { message: Schema.String },
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

// The PR's number at the end of the URL `gh pr create` prints, e.g. ".../pull/123".
const PR_URL = /https:\/\/\S+\/pull\/(\d+)/;

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
    push(
      cwd: string,
      push: { readonly commit: string; readonly branch: string },
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
  }
>()("@repo/server/codehost/CodeHost") {
  static readonly layer = Layer.effect(
    CodeHost,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      // Runs the command in the folder, returning what it printed; fails with its stderr when it
      // exits non-zero.
      const run = Effect.fn("CodeHost.run")(
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
          const line = [command, ...args.slice(0, 2)].join(" ");
          if (exitCode !== 0)
            return yield* new CodeHostError({
              message: `${line}: ${stderr.trim() || `exit ${exitCode}`}`,
            });
          return stdout;
        },
        Effect.scoped,
        Effect.catchTag("PlatformError", (cause) =>
          Effect.fail(new CodeHostError({ message: cause.message })),
        ),
        Effect.timeoutOrElse({
          duration: CALL_TIMEOUT,
          orElse: () =>
            Effect.fail(
              new CodeHostError({ message: "GitHub didn't answer in time" }),
            ),
        }),
      );

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
        }: { readonly commit: string; readonly branch: string },
      ) {
        yield* run(cwd, "git", [
          "push",
          "--quiet",
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

      return CodeHost.of({ ready, push, openDraft, link });
    }),
  );
}
