import { Schema } from "effect";
import { KeyValueStore } from "effect/persistence";
import { Atom } from "effect/reactivity";

const storage = Atom.runtime(KeyValueStore.layerStorage(() => localStorage));

// Whether the code panel shows beside the transcript. One choice for every Session, kept in the
// page's storage so switching Sessions or reloading never changes the layout. Closed until the
// developer opens it.
export const codePanelOpenAtom = Atom.kvs({
  runtime: storage,
  key: "fern.codePanelOpen",
  schema: Schema.Boolean,
  defaultValue: () => false,
}).pipe(Atom.keepAlive);

// The key that shows and hides the code panel: ⌘\.
export const isCodePanelToggle = (
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "code">,
) =>
  event.metaKey &&
  !event.ctrlKey &&
  !event.altKey &&
  event.code === "Backslash";

// What the code panel shows: a file, as an absolute path. Walkthroughs live in the Review tab.
export type OpenItem = { readonly kind: "file"; readonly path: string };

// What the developer opened in a Session's code panel. Until they open something, the panel
// follows Claude: the file Claude last changed.
export const openAtom = Atom.family((_sessionId: string) =>
  Atom.make<OpenItem | undefined>(undefined).pipe(Atom.keepAlive),
);

// Opens something in a Session's code panel from outside it, as a file named in the transcript,
// opening the panel too.
export const showInCodeAtom = Atom.family((sessionId: string) =>
  Atom.writable(
    (get) => get(openAtom(sessionId)),
    (ctx, item: OpenItem) => {
      ctx.set(openAtom(sessionId), item);
      ctx.set(codePanelOpenAtom, true);
    },
  ),
);
