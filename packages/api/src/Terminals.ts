import { Schema } from "effect";

// A terminal's size in character cells.
export const TerminalSize = Schema.Struct({
  cols: Schema.Int.check(Schema.isGreaterThan(0)),
  rows: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type TerminalSize = typeof TerminalSize.Type;

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

// One event from a Session's terminal.
export const TerminalEvent = Schema.Union([
  TerminalReplay,
  TerminalOutput,
  TerminalExit,
]);
export type TerminalEvent = typeof TerminalEvent.Type;

// The Session's shell couldn't be started, e.g. its folder is gone.
export class TerminalError extends Schema.TaggedError<TerminalError>()(
  "TerminalError",
  { message: Schema.String },
) {}
