import { FernApi } from "@repo/api";
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { NodeServices } from "@effect/platform-node";
import { Transcripts } from "./transcript/Transcripts";
import { Turns } from "./turn/Turns";
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
      send: ({ params, payload }) => turns.send(params.id, payload.text),
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
    return handlers.handleAll({
      files: ({ query }) => workspace.files(query.root),
      file: ({ query }) => workspace.file(query.root, query.path),
    });
  }),
);

// Handlers with their services still required, so tests can swap implementations.
export const HandlersNoDeps = Layer.mergeAll(
  SystemHandlers,
  SessionsHandlers,
  ProjectsHandlers,
);

export const Handlers = HandlersNoDeps.pipe(
  Layer.provide(Transcripts.layer),
  Layer.provide([Turns.layer, Workspace.layer]),
  Layer.provide(NodeServices.layer),
);
