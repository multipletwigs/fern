import { LiveRpcs } from "@repo/api";
import { Effect, Layer, Stream } from "effect";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { Autonomy } from "./autonomy/Autonomy";
import { Flows } from "./flow/Flows";
import { Rounds } from "./round/Rounds";
import { Subagents } from "./subagent/Subagents";
import { Terminals } from "./terminal/Terminals";
import { Transcripts } from "./transcript/Transcripts";
import { Walkthroughs } from "./walkthrough/Walkthroughs";
import { Workspace } from "./workspace/Workspace";

// The live streams, with their services still required, so tests can swap implementations.
export const LiveHandlersNoDeps = LiveRpcs.toLayer(
  Effect.gen(function* () {
    const transcripts = yield* Transcripts;
    const workspace = yield* Workspace;
    const walkthroughs = yield* Walkthroughs;
    const flows = yield* Flows;
    const rounds = yield* Rounds;
    const autonomy = yield* Autonomy;
    const subagents = yield* Subagents;
    const terminals = yield* Terminals;
    return LiveRpcs.of({
      Projects: () => transcripts.projects,
      Transcript: ({ id }) => Stream.unwrap(transcripts.live(id)),
      Subagents: ({ sessionId }) => Stream.unwrap(subagents.list(sessionId)),
      Subagent: ({ sessionId, agentId }) =>
        Stream.unwrap(subagents.live(sessionId, agentId)),
      ProjectFiles: ({ root }) => Stream.unwrap(workspace.files(root)),
      File: ({ root, path }) => Stream.unwrap(workspace.file(root, path)),
      Changes: ({ root, session }) =>
        Stream.unwrap(workspace.changes(root, session)),
      Walkthroughs: ({ session }) => walkthroughs.list(session),
      Flow: ({ session }) => flows.flow(session),
      Checkpoints: () => flows.checkpoints,
      SessionPhases: () => flows.phases,
      Rounds: ({ session }) => rounds.list(session),
      Autonomy: ({ session }) => autonomy.autonomy(session),
      Terminal: ({ sessionId, root, cols, rows }) =>
        terminals.open(sessionId, root, { cols, rows }),
      TerminalInput: ({ sessionId, data }) => terminals.write(sessionId, data),
      TerminalResize: ({ sessionId, cols, rows }) =>
        terminals.resize(sessionId, { cols, rows }),
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
