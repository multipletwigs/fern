import type { TerminalTarget } from "@repo/api";
import { Atom } from "effect/reactivity";

// What a terminal's panel is kept by: a Session's id, or `pr:<root>:<repo>#<n>` for a Foreign PR's
// in the Project at `root`, as the server keeps their shells.
export const terminalKeyOf = (target: TerminalTarget) =>
  target._tag === "Session"
    ? target.sessionId
    : `pr:${target.root}:${target.repo}#${target.number}`;

// Whether a terminal's panel shows, by `terminalKeyOf`, for as long as the page is open.
export const terminalOpenAtom = Atom.family((_key: string) =>
  Atom.make(false).pipe(Atom.keepAlive),
);

// How tall a terminal's panel is, in pixels, as last dragged, for as long as the page is open.
export const terminalHeightAtom = Atom.family((_key: string) =>
  Atom.make(280).pipe(Atom.keepAlive),
);

// The terminal panel's height, kept tall enough to type in and short enough to leave the chat
// in view.
export const clampTerminalHeight = (height: number, viewport: number) =>
  Math.round(Math.min(Math.max(height, 120), Math.max(120, viewport - 200)));

// The key that shows and hides the terminal: Ctrl+`.
export const isTerminalToggle = (event: KeyboardEvent) =>
  event.ctrlKey &&
  !event.metaKey &&
  !event.altKey &&
  event.code === "Backquote";
