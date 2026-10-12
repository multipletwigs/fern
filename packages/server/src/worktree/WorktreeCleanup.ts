import {
  SessionNotFound,
  UncommittedChanges,
  type WorktreeError,
} from "@repo/api";
import {
  Context,
  type Duration,
  Effect,
  Layer,
  Schedule,
  Semaphore,
} from "effect";
import { Flows } from "../flow/Flows";
import { HostedSessions } from "../turn/HostedSessions";
import { Turns } from "../turn/Turns";
import { Worktrees } from "./Worktrees";

// How often Fern looks for Sessions whose branches have merged, after looking once at startup.
export const CleanupInterval = Context.Reference<Duration.Input>(
  "@repo/server/worktree/CleanupInterval",
  { defaultValue: () => "5 minutes" },
);

// Takes Sessions' worktrees away once they're done with (ADR 0005): when the developer archives a
// Session, and when its branch has merged into `main` and its Flow is over. A merged Session is
// archived too. Worktrees with
// uncommitted changes are only removed when the developer says so.
export class WorktreeCleanup extends Context.Service<
  WorktreeCleanup,
  {
    // Stops the Session's turn and closes its Claude Code process, removes its worktree, and
    // archives it, keeping its branch. Refuses while the worktree has uncommitted changes, unless
    // `force`.
    archive(
      id: string,
      options: { readonly force: boolean },
    ): Effect.Effect<
      void,
      SessionNotFound | UncommittedChanges | WorktreeError
    >;
  }
>()("@repo/server/worktree/WorktreeCleanup") {
  static readonly layer = Layer.effect(
    WorktreeCleanup,
    Effect.gen(function* () {
      const hosted = yield* HostedSessions;
      const worktrees = yield* Worktrees;
      const turns = yield* Turns;
      const flows = yield* Flows;
      const interval = yield* CleanupInterval;
      // One removal at a time, so archiving and the merge sweep never race on a worktree.
      const lock = yield* Semaphore.make(1);

      const active = (id: string) =>
        hosted.worktrees.pipe(
          Effect.map((all) =>
            all.find((w) => w.id === id && w.archivedAt === null),
          ),
        );

      const archive = Effect.fn("WorktreeCleanup.archive")(function* (
        id: string,
        { force }: { readonly force: boolean },
      ) {
        const session = yield* active(id);
        if (!session) return yield* new SessionNotFound({ id });
        if (!force && (yield* worktrees.isDirty(session.worktree)))
          return yield* new UncommittedChanges({ id });
        yield* turns.close(id);
        yield* worktrees.remove(session.projectRoot, session.worktree, {
          force,
        });
        return yield* hosted.archive(id);
      }, lock.withPermits(1));

      // Archives every Session whose branch merged once its Flow is over, unless its turn is running
      // or its worktree has uncommitted changes.
      const sweep = Effect.gen(function* () {
        const sessions = (yield* hosted.worktrees).filter(
          (w) => w.archivedAt === null,
        );
        yield* Effect.forEach(
          sessions,
          (session) =>
            Effect.gen(function* () {
              if (!(yield* flows.isOver(session.id))) return;
              if (
                !(yield* worktrees.isMerged(
                  session.projectRoot,
                  session.branch,
                  session.baseCommit,
                ))
              )
                return;
              if (yield* worktrees.isDirty(session.worktree)) return;
              // Looked at last, right before the worktree goes: a turn may have started meanwhile.
              if ((yield* turns.running).includes(session.id)) return;
              yield* turns.close(session.id);
              yield* worktrees.remove(session.projectRoot, session.worktree, {
                force: false,
              });
              yield* hosted.archive(session.id);
            }).pipe(
              lock.withPermits(1),
              Effect.catch((error) =>
                Effect.logWarning(
                  `Couldn't clean up ${session.worktree}`,
                  error.message,
                ),
              ),
            ),
          { discard: true },
        );
      }).pipe(Effect.withSpan("WorktreeCleanup.sweep"));

      yield* sweep.pipe(
        Effect.repeat(Schedule.spaced(interval)),
        Effect.forkScoped,
      );

      return WorktreeCleanup.of({ archive });
    }),
  );
}
