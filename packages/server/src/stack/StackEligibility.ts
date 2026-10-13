import { Context, Effect, Layer } from "effect";
import { CodeHost } from "../codehost/CodeHost";
import { Git } from "../git/Git";
import { ProjectSettings } from "../project/ProjectSettings";
import { HostedSessions } from "../turn/HostedSessions";

// An `origin` on GitHub, over SSH or HTTPS.
const ON_GITHUB =
  /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)[^/]+\/[^/]+?(?:\.git)?\/?$/;

// When a Session's work lands as a Stack (ADR 0009): a Hosted Session in a worktree, in a Project
// that hasn't opted out, whose `origin` is on GitHub, with `gh` signed in and gh-stack installed.
// Everywhere else, work lands as it did before Stacks.
export class StackEligibility extends Context.Service<
  StackEligibility,
  {
    // Whether the Session's work lands as a Stack. Asked again each time, as the developer can opt
    // out or sign out of `gh` at any point. Never fails: anything Fern can't tell means no.
    applies(sessionId: string): Effect.Effect<boolean>;
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
          Effect.map((url) => ON_GITHUB.test(url.trim())),
          Effect.orElseSucceed(() => false),
        );

      const applies = Effect.fn("StackEligibility.applies")(function* (
        sessionId: string,
      ) {
        const session = yield* hosted.session(sessionId);
        if (
          !session ||
          session.worktree === null ||
          session.archivedAt !== null
        )
          return false;
        if (!(yield* settings.of(session.projectRoot)).stacks) return false;
        // Checked before `gh`, so a repo off GitHub never runs it.
        if (!(yield* onGitHub(session.cwd))) return false;
        return yield* codeHost.ready(session.cwd);
      });

      return StackEligibility.of({ applies });
    }),
  ).pipe(Layer.provide(Git.layer));
}
