import { LiveRpcs } from "@repo/api";
import { Effect, Layer, Stream } from "effect";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { Transcripts } from "./transcript/Transcripts";
import { Walkthroughs } from "./walkthrough/Walkthroughs";
import { Workspace } from "./workspace/Workspace";

// The live streams, with their services still required, so tests can swap implementations.
export const LiveHandlersNoDeps = LiveRpcs.toLayer(
  Effect.gen(function* () {
    const transcripts = yield* Transcripts;
    const workspace = yield* Workspace;
    const walkthroughs = yield* Walkthroughs;
    return LiveRpcs.of({
      Projects: () => transcripts.projects,
      Transcript: ({ id }) => Stream.unwrap(transcripts.live(id)),
      ProjectFiles: ({ root }) => Stream.unwrap(workspace.files(root)),
      File: ({ root, path }) => Stream.unwrap(workspace.file(root, path)),
      Changes: ({ root, session }) =>
        Stream.unwrap(workspace.changes(root, session)),
      Walkthroughs: ({ session }) => walkthroughs.list(session),
    });
  }),
);

// Serves the live streams over one WebSocket at /api/live, on the same router as FernApi. Needs
// their handlers.
export const LiveServer = RpcServer.layerHttp({
  group: LiveRpcs,
  path: "/api/live",
  protocol: "websocket",
}).pipe(Layer.provide(RpcSerialization.layerJson));
