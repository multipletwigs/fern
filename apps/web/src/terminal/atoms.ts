import { Atom } from "effect/reactivity";

// Whether a Session's terminal panel shows, for as long as the page is open.
export const terminalOpenAtom = Atom.family((_sessionId: string) =>
  Atom.make(false).pipe(Atom.keepAlive),
);

// The key that shows and hides the terminal: Ctrl+`.
export const isTerminalToggle = (event: KeyboardEvent) =>
  event.ctrlKey &&
  !event.metaKey &&
  !event.altKey &&
  event.code === "Backquote";
