import { FernApi, SessionRef } from "@repo/api";
import { Effect, Layer } from "effect";
import { HttpMiddleware } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { NodeServices } from "@effect/platform-node";
import type { ChildProcessSpawner } from "effect/process";
import { Autonomy } from "./autonomy/Autonomy";
import { Commands } from "./commands/Commands";
import { Flows } from "./flow/Flows";
import { IssueTracker } from "./issue/IssueTracker";
import { Transcripts } from "./transcript/Transcripts";
import { Snapshots } from "./snapshot/Snapshots";
import { Terminals } from "./terminal/Terminals";
import { SubagentFiles } from "./subagent/SubagentFiles";
import { Subagents } from "./subagent/Subagents";
import { LiveHandlersNoDeps } from "./live";
import { Rounds } from "./round/Rounds";
import { FernTools } from "./turn/FernTools";
import { HostedSessions } from "./turn/HostedSessions";
import { Turns } from "./turn/Turns";
import { VerifySlots } from "./verify/VerifySlots";
import { Walkthroughs } from "./walkthrough/Walkthroughs";
import { WalkthroughWriter } from "./walkthrough/WalkthroughWriter";
import { Workspace } from "./workspace/Workspace";
import { WorktreeCleanup } from "./worktree/WorktreeCleanup";
import { Worktrees } from "./worktree/Worktrees";

export const SystemHandlers = HttpApiBuilder.group(
  FernApi,
  "system",
  (handlers) => handlers.handleAll({ health: () => Effect.void }),
);

// A developer message corrects the agent's course when it says something: not an image on its own,
// a slash command, or only "continue".
const isRedirect = (text: string) => {
  const said = text.trim();
  return said !== "" && !said.startsWith("/") && !/^continue[.!]*$/i.test(said);
};

export const SessionsHandlers = HttpApiBuilder.group(
  FernApi,
  "sessions",
  Effect.fn(function* (handlers) {
    const transcripts = yield* Transcripts;
    const turns = yield* Turns;
    const cleanup = yield* WorktreeCleanup;
    const autonomy = yield* Autonomy;
    return handlers.handleAll({
      current: () => transcripts.current,
      running: () => turns.running,
      // Only the developer sends through here; Fern's own messages go straight to Turns.
      send: ({ params, payload }) =>
        turns
          .send(params.id, payload)
          .pipe(
            Effect.andThen(
              isRedirect(payload.text)
                ? autonomy.redirected(params.id, "message")
                : Effect.void,
            ),
          ),
      start: ({ payload }) =>
        turns
          .start(payload.root, payload.message)
          .pipe(Effect.map((id) => new SessionRef({ id }))),
      interrupt: ({ params }) => turns.interrupt(params.id),
      unqueue: ({ params }) => turns.unqueue(params.id, params.item),
      archive: ({ params, payload }) =>
        cleanup.archive(params.id, { force: payload.force ?? false }),
    });
  }),
);

export const ProjectsHandlers = HttpApiBuilder.group(
  FernApi,
  "projects",
  Effect.fn(function* (handlers) {
    const commands = yield* Commands;
    return handlers.handleAll({
      commands: ({ query }) => commands.list(query.root),
    });
  }),
);

export const WalkthroughsHandlers = HttpApiBuilder.group(
  FernApi,
  "walkthroughs",
  Effect.fn(function* (handlers) {
    const walkthroughs = yield* Walkthroughs;
    return handlers.handleAll({
      write: ({ payload }) => walkthroughs.write(payload.session),
      verdict: ({ params, payload }) =>
        walkthroughs.verdict(params.id, params.item, payload),
      redirect: ({ params }) => walkthroughs.redirect(params.id),
    });
  }),
);

export const FlowsHandlers = HttpApiBuilder.group(
  FernApi,
  "flows",
  Effect.fn(function* (handlers) {
    const flows = yield* Flows;
    return handlers.handleAll({
      approve: ({ params }) => flows.approve(params.id),
      decline: ({ params, payload }) => flows.decline(params.id, payload.note),
      skip: ({ params, payload }) =>
        flows.skip(params.session, payload.phase, payload.reason),
      findingVerdict: ({ params, payload }) =>
        flows.findingVerdict(params.id, payload),
    });
  }),
);

export const RoundsHandlers = HttpApiBuilder.group(
  FernApi,
  "rounds",
  Effect.fn(function* (handlers) {
    const rounds = yield* Rounds;
    return handlers.handleAll({
      answer: ({ params, payload }) =>
        rounds.answer(params.id, payload.answers),
    });
  }),
);

export const AutonomyHandlers = HttpApiBuilder.group(
  FernApi,
  "autonomy",
  Effect.fn(function* (handlers) {
    const autonomy = yield* Autonomy;
    return handlers.handleAll({
      accept: ({ params }) => autonomy.accept(params.id),
      decline: ({ params }) => autonomy.decline(params.id),
    });
  }),
);

export const SubagentsHandlers = HttpApiBuilder.group(
  FernApi,
  "subagents",
  Effect.fn(function* (handlers) {
    const subagents = yield* Subagents;
    return handlers.handleAll({
      close: ({ params }) => subagents.close(params.sessionId, params.agentId),
      reopen: ({ params }) =>
        subagents.reopen(params.sessionId, params.agentId),
    });
  }),
);

export const VerifySlotsHandlers = HttpApiBuilder.group(
  FernApi,
  "verifySlots",
  Effect.fn(function* (handlers) {
    const slots = yield* VerifySlots;
    // The sidebar asks every few seconds; logging each would drown the rest.
    return handlers.handleAll({
      running: () => HttpMiddleware.withLoggerDisabled(slots.running),
    });
  }),
);

// Handlers with their services still required, so tests can swap implementations.
export const HandlersNoDeps = Layer.mergeAll(
  SystemHandlers,
  SessionsHandlers,
  ProjectsHandlers,
  WalkthroughsHandlers,
  FlowsHandlers,
  RoundsHandlers,
  AutonomyHandlers,
  SubagentsHandlers,
  VerifySlotsHandlers,
);

// FernApi's handlers and the live streams', on one set of the real services, with a Walkthrough
// writer of the caller's choosing. Everything but the database and the worktrees' folder, which
// the app keeps with its data. The issue tracker is GitHub's unless the caller gives another.
export const handlersWith = (
  writer: Layer.Layer<WalkthroughWriter>,
  issues: Layer.Layer<
    IssueTracker,
    never,
    ChildProcessSpawner.ChildProcessSpawner
  > = IssueTracker.layer,
) =>
  Layer.mergeAll(HandlersNoDeps, LiveHandlersNoDeps).pipe(
    Layer.provide([
      Transcripts.layer,
      WorktreeCleanup.layer,
      Rounds.layer,
      VerifySlots.layer,
      Terminals.layer,
    ]),
    // The chat's Agent call rows show where each Subagent stands as its tab does.
    Layer.provideMerge(Subagents.layer),
    // The merge sweep waits for a Session's Flow to be over.
    Layer.provideMerge(Flows.layer),
    // Flows writes the Walkthrough the end of Implement waits on.
    Layer.provideMerge(Walkthroughs.layer),
    Layer.provide([
      Turns.layer,
      Workspace.layer,
      Commands.layer,
      Autonomy.layer,
      SubagentFiles.layer,
    ]),
    Layer.provide([
      Snapshots.layer,
      HostedSessions.layer,
      FernTools.layer,
      Worktrees.layer,
      writer,
      issues,
    ]),
    Layer.provide(NodeServices.layer),
  );

export const Handlers = handlersWith(WalkthroughWriter.layer);
