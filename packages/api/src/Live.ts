import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import {
  FileContent,
  FileNotFound,
  ProjectNotFound,
  SessionChanges,
  WorkspaceError,
} from "./Projects";
import {
  Project,
  SessionNotFound,
  TranscriptError,
  TranscriptUpdate,
} from "./Sessions";
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
) {}
