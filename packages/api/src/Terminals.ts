import { Schema } from "effect";
import { GitHubRepoName } from "./PullRequests";

// Whose terminal it is: a Session's, in its folder, or a Foreign PR's, in the worktree Try it
// checked it out in for the Project at `root`. The server finds the folder from its own records,
// never from the page.
export const TerminalTarget = Schema.Union([
  Schema.TaggedStruct("Session", { sessionId: Schema.NonEmptyString }),
  Schema.TaggedStruct("PullRequest", {
    root: Schema.NonEmptyString,
    repo: GitHubRepoName,
    number: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
]);
export type TerminalTarget = typeof TerminalTarget.Type;

// A terminal's size in character cells, no screen showing more than a thousand either way.
const Cells = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }));
export const TerminalSize = Schema.Struct({ cols: Cells, rows: Cells });
export type TerminalSize = typeof TerminalSize.Type;

// The most typed into a terminal at once, in UTF-16 code units. A bigger paste goes in pieces.
export const TERMINAL_INPUT_MAX = 65_536;

export const TerminalInputData = Schema.String.check(
  Schema.isMaxLength(TERMINAL_INPUT_MAX),
);

// What the shell printed before the viewer came, as much as is kept: the first event of every
// terminal stream. It stands for everything the shell has printed so far, so a terminal shows it in
// place of whatever it showed before.
export const TerminalReplay = Schema.TaggedStruct("TerminalReplay", {
  data: Schema.String,
});

// What the shell printed, as the terminal should be fed it.
export const TerminalOutput = Schema.TaggedStruct("TerminalOutput", {
  data: Schema.String,
});

// The shell exited, with its exit code. The last event of a terminal's stream.
export const TerminalExit = Schema.TaggedStruct("TerminalExit", {
  code: Schema.Int,
});

// One event from a terminal.
export const TerminalEvent = Schema.Union([
  TerminalReplay,
  TerminalOutput,
  TerminalExit,
]);
export type TerminalEvent = typeof TerminalEvent.Type;

// The terminal's shell couldn't be started, e.g. its folder is gone, or isn't running.
export class TerminalError extends Schema.TaggedError<TerminalError>()(
  "TerminalError",
  { message: Schema.String },
) {}
