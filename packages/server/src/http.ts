import { FernApi, SessionRef } from "@repo/api";
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { NodeServices } from "@effect/platform-node";
import { Commands } from "./commands/Commands";
import { Transcripts } from "./transcript/Transcripts";
import { Snapshots } from "./snapshot/Snapshots";
import { HostedSessions } from "./turn/HostedSessions";
import { Turns } from "./turn/Turns";
import { Walkthroughs } from "./walkthrough/Walkthroughs";
import { WalkthroughWriter } from "./walkthrough/WalkthroughWriter";
import { Workspace } from "./workspace/Workspace";

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
      projects: () => Effect.succeed(transcripts.projects),
      running: () => turns.running,
      send: ({ params, payload }) => turns.send(params.id, payload),
      start: ({ payload }) =>
        turns
          .start(payload.cwd, payload.message)
          .pipe(Effect.map((id) => new SessionRef({ id }))),
      interrupt: ({ params }) => turns.interrupt(params.id),
      live: ({ params }) => transcripts.live(params.id),
    });
  }),
);

export const ProjectsHandlers = HttpApiBuilder.group(
  FernApi,
  "projects",
  Effect.fn(function* (handlers) {
    const workspace = yield* Workspace;
    const commands = yield* Commands;
    return handlers.handleAll({
      files: ({ query }) => workspace.files(query.root),
      file: ({ query }) => workspace.file(query.root, query.path),
      changes: ({ query }) => workspace.changes(query.root, query.session),
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
      list: ({ query }) => Effect.succeed(walkthroughs.list(query.session)),
      write: ({ payload }) => walkthroughs.write(payload.session),
      verdict: ({ params, payload }) =>
        walkthroughs.verdict(params.id, params.item, payload),
      redirect: ({ params }) => walkthroughs.redirect(params.id),
    });
  }),
);

// Handlers with their services still required, so tests can swap implementations.
export const HandlersNoDeps = Layer.mergeAll(
  SystemHandlers,
  SessionsHandlers,
  ProjectsHandlers,
  WalkthroughsHandlers,
);

// The handlers on the real services, with a Walkthrough writer of the caller's choosing. Everything
// but the database, which the app opens where it keeps its data.
export const handlersWith = (writer: Layer.Layer<WalkthroughWriter>) =>
  HandlersNoDeps.pipe(
    Layer.provide([Transcripts.layer, Walkthroughs.layer]),
    Layer.provide([Turns.layer, Workspace.layer, Commands.layer]),
    Layer.provide([Snapshots.layer, HostedSessions.layer, writer]),
    Layer.provide(NodeServices.layer),
  );

export const Handlers = handlersWith(WalkthroughWriter.layer);
