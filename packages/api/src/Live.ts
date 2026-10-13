import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { SessionAutonomy } from "./Autonomy";
import { Checkpoint, Flow, SessionPhase } from "./Flows";
import {
  FileContent,
  FileNotFound,
  ProjectNotFound,
  SessionChanges,
  WorkspaceError,
} from "./Projects";
import { SessionRounds } from "./Rounds";
import {
  Project,
  SessionNotFound,
  TranscriptError,
  TranscriptUpdate,
} from "./Sessions";
import { SubagentNotFound, SubagentSummary, SubagentUpdate } from "./Subagents";
import { TerminalError, TerminalEvent, TerminalSize } from "./Terminals";
import { Walkthrough, WalkthroughError } from "./Walkthroughs";

// Everything the page keeps current, each a stream of the latest value, all over one WebSocket at
// /api/live. Over HTTP each stream held a connection open, and Chromium allows a page six per
// server, so a seventh request, even a script, waited for one to close. Requests that answer once
// stay on FernApi.
export class LiveRpcs extends RpcGroup.make(
  // Every Project, most recently active first, re-sent whenever a Session changes.
  Rpc.make("Projects", {
    success: Schema.Array(Project),
    error: TranscriptError,
    stream: true,
  }),
  // A Session's transcript: everything, then what changes.
  Rpc.make("Transcript", {
    payload: { id: Schema.NonEmptyString },
    success: TranscriptUpdate,
    error: Schema.Union([SessionNotFound, TranscriptError]),
    stream: true,
  }),
  // A Session's Subagents in the order they started, re-sent whenever one starts or changes.
  Rpc.make("Subagents", {
    payload: { sessionId: Schema.NonEmptyString },
    success: Schema.Array(SubagentSummary),
    error: Schema.Union([SessionNotFound, TranscriptError]),
    stream: true,
  }),
  // One Subagent's Assignment and work: everything, then what changes.
  Rpc.make("Subagent", {
    payload: {
      sessionId: Schema.NonEmptyString,
      agentId: Schema.NonEmptyString,
    },
    success: SubagentUpdate,
    error: Schema.Union([SessionNotFound, SubagentNotFound, TranscriptError]),
    stream: true,
  }),
  // Every file git doesn't ignore in a Project's folder, as relative paths, re-sent when the set
  // changes.
  Rpc.make("ProjectFiles", {
    payload: { root: Schema.NonEmptyString },
    success: Schema.Array(Schema.String),
    error: Schema.Union([ProjectNotFound, WorkspaceError]),
    stream: true,
  }),
  // One file, re-sent whenever it changes on disk.
  Rpc.make("File", {
    payload: { root: Schema.NonEmptyString, path: Schema.NonEmptyString },
    success: FileContent,
    error: Schema.Union([ProjectNotFound, FileNotFound, WorkspaceError]),
    stream: true,
  }),
  // A Session's net change in a Project's folder, re-sent when it changes.
  Rpc.make("Changes", {
    payload: {
      root: Schema.NonEmptyString,
      session: Schema.NonEmptyString,
    },
    success: SessionChanges,
    error: Schema.Union([ProjectNotFound, WorkspaceError]),
    stream: true,
  }),
  // A Session's Walkthroughs, oldest first, re-sent whenever one changes.
  Rpc.make("Walkthroughs", {
    payload: { session: Schema.NonEmptyString },
    success: Schema.Array(Walkthrough),
    error: WalkthroughError,
    stream: true,
  }),
  // A Hosted Session's Flow, re-sent whenever it changes. Null for a Session outside the Flow.
  Rpc.make("Flow", {
    payload: { session: Schema.NonEmptyString },
    success: Schema.NullOr(Flow),
    stream: true,
  }),
  // Every Session's pending Checkpoint, oldest first: the one queue the developer clears.
  Rpc.make("Checkpoints", {
    success: Schema.Array(Checkpoint),
    stream: true,
  }),
  // Every Hosted Session's current Phase, re-sent whenever one moves on.
  Rpc.make("SessionPhases", {
    success: Schema.Array(SessionPhase),
    stream: true,
  }),
  // A Session's open Round and its Decisions, re-sent whenever either changes.
  Rpc.make("Rounds", {
    payload: { session: Schema.NonEmptyString },
    success: SessionRounds,
    stream: true,
  }),
  // A Hosted Session's Project's streaks, Milestone offers and Autonomy at each earnable boundary,
  // re-sent whenever they change. Null for a Session outside the Flow.
  Rpc.make("Autonomy", {
    payload: { session: Schema.NonEmptyString },
    success: Schema.NullOr(SessionAutonomy),
    stream: true,
  }),
  // A Session's terminal: a shell in its folder, its worktree or else its Project's, as the server
  // knows it, started at `cols` by `rows` unless one is running there already, in which case this
  // attaches to it. Streams what the shell has printed lately, as a replay, then what it goes on to
  // print, then its exit. A shell that has exited is replayed up to its exit until
  // `TerminalRestart`. Ending the stream detaches; the shell runs on.
  Rpc.make("Terminal", {
    payload: {
      sessionId: Schema.NonEmptyString,
      ...TerminalSize.fields,
    },
    success: TerminalEvent,
    error: TerminalError,
    stream: true,
  }),
  // Keystrokes or a paste, typed into a Session's terminal. Dropped when its shell isn't running.
  Rpc.make("TerminalInput", {
    payload: { sessionId: Schema.NonEmptyString, data: Schema.String },
  }),
  // The size a Session's terminal is shown at.
  Rpc.make("TerminalResize", {
    payload: { sessionId: Schema.NonEmptyString, ...TerminalSize.fields },
  }),
  // Ends a Session's shell, if it's still running, so the next `Terminal` starts a fresh one.
  Rpc.make("TerminalRestart", {
    payload: { sessionId: Schema.NonEmptyString },
  }),
) {}
