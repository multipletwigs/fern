import { Context, Effect, Layer, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export class GitError extends Schema.TaggedError<GitError>()("GitError", {
  message: Schema.String,
}) {}

// Runs git in a repository and returns its stdout, failing with its stderr when it exits non-zero.
export class Git extends Context.Service<
  Git,
  {
    run(
      repo: string,
      args: ReadonlyArray<string>,
      env?: Record<string, string>,
    ): Effect.Effect<string, GitError>;
  }
>()("@repo/server/git/Git") {
  static readonly layer = Layer.effect(
    Git,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const run = Effect.fn("Git.run")(
        function* (
          repo: string,
          args: ReadonlyArray<string>,
          env?: Record<string, string>,
        ) {
          const handle = yield* spawner.spawn(
            ChildProcess.make(
              "git",
              // Paths come back as written, not octal-escaped.
              ["-C", repo, "-c", "core.quotePath=false", ...args],
              { env, extendEnv: true },
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
          if (exitCode !== 0)
            return yield* new GitError({
              message: `git ${args[0]}: ${stderr.trim() || `exit ${exitCode}`}`,
            });
          return stdout;
        },
        Effect.scoped,
        Effect.catchTag("PlatformError", (cause) =>
          Effect.fail(new GitError({ message: `git: ${cause.message}` })),
        ),
      );

      return Git.of({ run });
    }),
  );
}
