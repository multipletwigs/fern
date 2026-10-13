import { Atom } from "effect/reactivity";

// Whether a Session's terminal panel shows, for as long as the page is open.
export const terminalOpenAtom = Atom.family((_sessionId: string) =>
  Atom.make(false).pipe(Atom.keepAlive),
);

// How tall a Session's terminal panel is, in pixels, as last dragged, for as long as the page is
// open.
export const terminalHeightAtom = Atom.family((_sessionId: string) =>
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
