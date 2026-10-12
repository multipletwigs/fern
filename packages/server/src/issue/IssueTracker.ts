import { GhIssueState, IssueState } from "@repo/api";
import { Context, Effect, Layer, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

// An issue on a Project's issue tracker, as Fern sees it.
export const TrackedIssue = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  state: IssueState,
});
export type TrackedIssue = typeof TrackedIssue.Type;

export class IssueTrackerError extends Schema.TaggedError<IssueTrackerError>()(
  "IssueTrackerError",
  { message: Schema.String },
) {}

// What `gh issue view --json number,title,url,state` prints; gh writes the state in capitals.
const GhIssue = Schema.fromJsonString(
  Schema.Struct({
    number: Schema.Int,
    title: Schema.String,
    url: Schema.String,
    state: GhIssueState,
  }),
);
const decodeGhIssue = Schema.decodeUnknownEffect(GhIssue);

// What gh says for a number with no issue behind it.
const NOT_FOUND = /could not resolve to an issue/i;

// The issue tracker of the repository a folder is in: where Spec writes the Brief and its tickets,
// and where Implement closes them. The live one asks GitHub through the `gh` CLI.
export class IssueTracker extends Context.Service<
  IssueTracker,
  {
    // The issue with the number on the tracker of the repository `cwd` is in; none if it has no
    // such issue. Fails if the tracker can't be asked.
    issue(
      cwd: string,
      number: number,
    ): Effect.Effect<Option.Option<TrackedIssue>, IssueTrackerError>;
  }
>()("@repo/server/issue/IssueTracker") {
  static readonly layer = Layer.effect(
    IssueTracker,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const issue = Effect.fn("IssueTracker.issue")(
        function* (cwd: string, number: number) {
          const handle = yield* spawner.spawn(
            ChildProcess.make(
              "gh",
              [
                "issue",
                "view",
                String(number),
                "--json",
                "number,title,url,state",
              ],
              { cwd, extendEnv: true },
            ),
          );
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
              handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
              handle.exitCode,
            ],
            { concurrency: "unbounded" },
          );
          if (exitCode !== 0) {
            if (NOT_FOUND.test(stderr)) return Option.none<TrackedIssue>();
            return yield* new IssueTrackerError({
              message: `gh issue view: ${stderr.trim() || `exit ${exitCode}`}`,
            });
          }
          const found = yield* decodeGhIssue(stdout).pipe(
            Effect.mapError(
              (cause) =>
                new IssueTrackerError({
                  message: `gh issue view: ${cause.message}`,
                }),
            ),
          );
          return Option.some<TrackedIssue>({
            number: found.number,
            title: found.title,
            url: found.url,
            state: found.state === "OPEN" ? "open" : "closed",
          });
        },
        Effect.scoped,
        Effect.catchTag("PlatformError", (cause) =>
          Effect.fail(
            new IssueTrackerError({ message: `gh: ${cause.message}` }),
          ),
        ),
      );

      return IssueTracker.of({ issue });
    }),
  );
}
