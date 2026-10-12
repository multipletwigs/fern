import { FernApi, SessionRef } from "@repo/api";
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { NodeServices } from "@effect/platform-node";
import { Commands } from "./commands/Commands";
import { Transcripts } from "./transcript/Transcripts";
import { Snapshots } from "./snapshot/Snapshots";
import { LiveHandlersNoDeps } from "./live";
import { Rounds } from "./round/Rounds";
import { FernTools } from "./turn/FernTools";
import { HostedSessions } from "./turn/HostedSessions";
import { Turns } from "./turn/Turns";
import { Walkthroughs } from "./walkthrough/Walkthroughs";
import { WalkthroughWriter } from "./walkthrough/WalkthroughWriter";
import { Workspace } from "./workspace/Workspace";
import { Worktrees } from "./worktree/Worktrees";

export const SystemHandlers = HttpApiBuilder.group(
  FernApi,
  "system",
  (handlers) => handlers.handleAll({ health: () => Effect.void }),
);

export const SessionsHandlers = HttpApiBuilder.group(
  FernApi,
  "sessions",
  Effect.fn(function* (handlers) {
    const transcripts = yield* Transcripts;
    const turns = yield* Turns;
    return handlers.handleAll({
      current: () => transcripts.current,
      running: () => turns.running,
      send: ({ params, payload }) => turns.send(params.id, payload),
      start: ({ payload }) =>
        turns
          .start(payload.root, payload.message)
          .pipe(Effect.map((id) => new SessionRef({ id }))),
      interrupt: ({ params }) => turns.interrupt(params.id),
      unqueue: ({ params }) => turns.unqueue(params.id, params.item),
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

// Handlers with their services still required, so tests can swap implementations.
export const HandlersNoDeps = Layer.mergeAll(
  SystemHandlers,
  SessionsHandlers,
  ProjectsHandlers,
  WalkthroughsHandlers,
  RoundsHandlers,
);

// FernApi's handlers and the live streams', on one set of the real services, with a Walkthrough
// writer of the caller's choosing. Everything but the database and the worktrees' folder, which
// the app keeps with its data.
export const handlersWith = (writer: Layer.Layer<WalkthroughWriter>) =>
  Layer.mergeAll(HandlersNoDeps, LiveHandlersNoDeps).pipe(
    Layer.provide([Transcripts.layer, Walkthroughs.layer, Rounds.layer]),
    Layer.provide([Turns.layer, Workspace.layer, Commands.layer]),
    Layer.provide([
      Snapshots.layer,
      HostedSessions.layer,
      FernTools.layer,
      Worktrees.layer,
      writer,
    ]),
    Layer.provide(NodeServices.layer),
  );

export const Handlers = handlersWith(WalkthroughWriter.layer);
