import { DeveloperTool, ToolFix, ToolStatus } from "@repo/api";
import { Context, Duration, Effect, Layer, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

// How long one check waits on a command before giving up on it, as `gh` can hang on the network.
export const ToolCheckTimeout = Context.Reference<Duration.Duration>(
  "@repo/server/tools/ToolCheckTimeout",
  { defaultValue: () => Duration.seconds(5) },
);

// Where to install each tool from.
const INSTALL: Record<DeveloperTool, string> = {
  claude: "https://code.claude.com/docs/en/setup",
  gh: "https://cli.github.com",
  git: "https://git-scm.com/downloads",
};

// What a command printed and how it exited.
interface Answer {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// Why a command gave no answer to read: the tool isn't there, or the check couldn't tell.
type NoAnswer = Pick<ToolStatus, "state" | "detail" | "fix">;

// The version number in `--version`'s first line, e.g. "2.50.1" in "git version 2.50.1 (Apple
// Git-155)"; the whole line if it has none.
const parseVersion = (stdout: string) => {
  const line = stdout.trim().split("\n")[0]?.trim() ?? "";
  return /\d+(?:\.\d+)+/.exec(line)?.[0] ?? (line || undefined);
};

// The login in `gh auth status`'s "Logged in to github.com account octocat"; older `gh` says "as".
const parseAccount = (output: string) =>
  /Logged in to \S+ (?:account|as) (\S+)/.exec(output)?.[1];

// The tools Fern runs on that the developer installs and signs in to themselves, checked the way
// Fern's own processes would run them: on the server's environment and its PATH.
export class Tools extends Context.Service<
  Tools,
  {
    // Each tool's status, in the order Settings lists them, every check run at once. A tool that
    // can't be found or doesn't answer is a status, never a failure.
    readonly check: Effect.Effect<ReadonlyArray<ToolStatus>>;
  }
>()("@repo/server/tools/Tools") {
  static readonly layer = Layer.effect(
    Tools,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const timeout = yield* ToolCheckTimeout;

      // Runs the command, failing with what to show when it can't be read.
      const ask = (command: DeveloperTool, args: ReadonlyArray<string>) => {
        const line = [command, ...args].join(" ");
        return spawner
          .spawn(
            ChildProcess.make(command, args, {
              extendEnv: true,
              stdin: "ignore",
            }),
          )
          .pipe(
            Effect.flatMap((handle) =>
              Effect.all(
                [
                  handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
                  handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
                  handle.exitCode,
                ],
                { concurrency: "unbounded" },
              ),
            ),
            Effect.map(([stdout, stderr, exitCode]): Answer => ({
              stdout,
              stderr,
              exitCode,
            })),
            Effect.scoped,
            Effect.mapError((error): NoAnswer =>
              error.reason._tag === "NotFound"
                ? {
                    state: "missing",
                    detail: "Not found on the PATH Fern runs with",
                    fix: new ToolFix({ url: INSTALL[command] }),
                  }
                : { state: "unknown", detail: `${line}: ${error.message}` },
            ),
            Effect.timeoutOrElse({
              duration: timeout,
              orElse: () =>
                Effect.fail<NoAnswer>({
                  state: "unknown",
                  detail: `${line} didn't answer within ${Duration.format(timeout)}`,
                }),
            }),
          );
      };

      const checkOne = Effect.fn("Tools.checkOne")(
        function* (tool: DeveloperTool) {
          const answer = yield* ask(tool, ["--version"]);
          if (answer.exitCode !== 0)
            return new ToolStatus({
              tool,
              state: "unknown",
              detail: `${tool} --version exited with ${answer.exitCode}`,
            });
          const version = parseVersion(answer.stdout);
          if (tool !== "gh")
            return new ToolStatus({ tool, state: "ready", version });

          const auth = yield* ask("gh", ["auth", "status"]).pipe(
            Effect.mapError((noAnswer) => ({ ...noAnswer, version })),
          );
          if (auth.exitCode !== 0)
            return new ToolStatus({
              tool,
              state: "needs-attention",
              version,
              detail: "Not signed in to GitHub",
              fix: new ToolFix({ command: "gh auth login" }),
            });
          return new ToolStatus({
            tool,
            state: "ready",
            version,
            // Older `gh` prints its status to stderr.
            account: parseAccount(auth.stdout + auth.stderr),
          });
        },
        (effect, tool) =>
          Effect.catch(effect, (noAnswer: NoAnswer & { version?: string }) =>
            Effect.succeed(new ToolStatus({ tool, ...noAnswer })),
          ),
      );

      const check = Effect.forEach(DeveloperTool.literals, checkOne, {
        concurrency: "unbounded",
      });

      return Tools.of({ check });
    }),
  );
}
