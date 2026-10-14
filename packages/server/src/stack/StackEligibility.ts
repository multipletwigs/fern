import { Cache, Context, Effect, Layer, Option, Schema } from "effect";
import { BranchName, CodeHost } from "../codehost/CodeHost";
import { gitHubRepo } from "../codehost/gitHubRepo";
import { Git } from "../git/Git";
import { ProjectSettings } from "../project/ProjectSettings";
import { HostedSessions } from "../turn/HostedSessions";

// Where git keeps `origin`'s default branch, once it knows it.
const ORIGIN_HEAD = "refs/remotes/origin/";

// How long Fern goes by what `gh` and git last said about a folder's repository: long enough that
// opening a Session or ending a turn asks once, short enough that signing out of `gh` soon shows.
const REMEMBERED = "30 seconds";

// A branch name git or GitHub gave, if Fern can use it as one.
const branchName = (name: string) =>
  Schema.decodeOption(BranchName)(name.trim());

// When a Session's work lands as a Stack (ADR 0009): a Hosted Session in a worktree, in a Project
// that hasn't opted out, whose `origin` is on GitHub, with `gh` signed in and gh-stack installed,
// and whose default branch Fern can tell, as every Stack is based on it. Everywhere else, work
// lands as it did before Stacks.
export class StackEligibility extends Context.Service<
  StackEligibility,
  {
    // Whether the Session's work lands as a Stack. The Project's settings are read each time, as
    // the developer can opt out at any point; what `gh` says, for a few seconds. Never fails:
    // anything Fern can't tell means no.
    applies(sessionId: string): Effect.Effect<boolean>;
    // The branch the Session's Stack is based on: its repo's default branch, wherever its work
    // lands as a Stack.
    trunk(sessionId: string): Effect.Effect<Option.Option<string>>;
  }
>()("@repo/server/stack/StackEligibility") {
  static readonly layer = Layer.effect(
    StackEligibility,
    Effect.gen(function* () {
      const hosted = yield* HostedSessions;
      const settings = yield* ProjectSettings;
      const codeHost = yield* CodeHost;
      const git = yield* Git;

      const onGitHub = (cwd: string) =>
        git.run(cwd, ["remote", "get-url", "origin"]).pipe(
          Effect.map((url) => Option.isSome(gitHubRepo(url))),
          Effect.orElseSucceed(() => false),
        );

      // `origin`'s default branch as git last fetched it; else as GitHub says.
      const defaultBranch = (cwd: string) =>
        git
          .run(cwd, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"])
          .pipe(
            Effect.map((ref) => ref.trim()),
            Effect.flatMap((ref) =>
              ref.startsWith(ORIGIN_HEAD)
                ? Effect.succeed(ref.slice(ORIGIN_HEAD.length))
                : Effect.fail(ref),
            ),
            Effect.catch(() => codeHost.defaultBranch(cwd)),
            Effect.map(branchName),
            Effect.orElseSucceed(() => Option.none<string>()),
          );

      // The branch a Stack from the folder is based on, where one can go up from it at all.
      // Checked for GitHub before `gh`, so a repo off GitHub never runs it.
      const trunkOf = yield* Cache.make({
        capacity: 1024,
        timeToLive: REMEMBERED,
        lookup: (cwd: string) =>
          Effect.gen(function* () {
            if (!(yield* onGitHub(cwd))) return Option.none<string>();
            const [ready, trunk] = yield* Effect.all(
              [codeHost.ready(cwd), defaultBranch(cwd)],
              { concurrency: "unbounded" },
            );
            return ready ? trunk : Option.none<string>();
          }),
      });

      const trunk = Effect.fn("StackEligibility.trunk")(function* (
        sessionId: string,
      ) {
        const session = yield* hosted.session(sessionId);
        if (
          !session ||
          session.worktree === null ||
          session.archivedAt !== null
        )
          return Option.none<string>();
        if (!(yield* settings.of(session.projectRoot)).stacks)
          return Option.none<string>();
        return yield* Cache.get(trunkOf, session.cwd);
      });

      return StackEligibility.of({
        applies: (sessionId) =>
          trunk(sessionId).pipe(Effect.map(Option.isSome)),
        trunk,
      });
    }),
  ).pipe(Layer.provide(Git.layer));
}
