import { LiveRpcs, TerminalError, type TerminalTarget } from "@repo/api";
import { Effect, Layer, Option, Stream } from "effect";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { Autonomy } from "./autonomy/Autonomy";
import { Flows } from "./flow/Flows";
import { PullRequests } from "./pullrequest/PullRequests";
import { Rounds } from "./round/Rounds";
import { Subagents } from "./subagent/Subagents";
import { prTerminalKey, Terminals } from "./terminal/Terminals";
import { Transcripts } from "./transcript/Transcripts";
import { Walkthroughs } from "./walkthrough/Walkthroughs";
import { Workspace } from "./workspace/Workspace";

// What the terminal's shell is kept by: a Session's id, or the Foreign PR's own key.
const keyOf = (target: TerminalTarget) =>
  target._tag === "Session" ? target.sessionId : prTerminalKey(target);

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
    const pullRequests = yield* PullRequests;

    // A Session's worktree or else its Project's folder; a Foreign PR's worktree, once Try it has
    // made it.
    const folderOf = (target: TerminalTarget) =>
      target._tag === "Session"
        ? transcripts.folder(target.sessionId).pipe(
            Effect.mapError(
              (error) =>
                new TerminalError({
                  message:
                    error._tag === "SessionNotFound"
                      ? "Fern doesn't know this Session's folder"
                      : error.message,
                }),
            ),
          )
        : pullRequests.worktree(target).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(
                    new TerminalError({
                      message: `PR #${target.number} has no worktree. Try it to check it out.`,
                    }),
                  ),
                onSome: Effect.succeed,
              }),
            ),
          );

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
      PullRequestWalkthroughs: ({ repo, number }) =>
        walkthroughs.listForeign(repo, number),
      PullRequestWalkthroughStates: ({ repo }) =>
        walkthroughs.liveForeignStates(repo),
      Flow: ({ session }) => flows.flow(session),
      Checkpoints: () => flows.checkpoints,
      SessionPhases: () => flows.phases,
      Rounds: ({ session }) => rounds.list(session),
      Autonomy: ({ session }) => autonomy.autonomy(session),
      // In the folder Fern knows the target by, never one the page names.
      Terminal: ({ target, cols, rows }) =>
        Stream.unwrap(
          folderOf(target).pipe(
            Effect.map((root) =>
              terminals.open(keyOf(target), root, { cols, rows }),
            ),
          ),
        ),
      TerminalInput: ({ target, data }) =>
        terminals.write(keyOf(target), data),
      TerminalResize: ({ target, cols, rows }) =>
        terminals.resize(keyOf(target), { cols, rows }),
      TerminalRestart: ({ target }) => terminals.kill(keyOf(target)),
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
