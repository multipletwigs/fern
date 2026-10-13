import { afterEach, assert, it, vi } from "@effect/vitest";
import { AtomRegistry } from "effect/reactivity";
import {
  codePanelOpenAtom,
  isCodePanelToggle,
  openAtom,
  showInCodeAtom,
} from "../src/code/panel";

// Whether the code panel shows: one choice for every Session, kept in the page's storage.

// The page's storage, as a reload finds it.
const storage = (): Storage => {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => void entries.delete(key),
    setItem: (key, value) => void entries.set(key, value),
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

it("starts closed", () => {
  vi.stubGlobal("localStorage", storage());
  const registry = AtomRegistry.make();
  assert.isFalse(registry.get(codePanelOpenAtom));
});

it("stays open across a reload once opened", () => {
  vi.stubGlobal("localStorage", storage());
  AtomRegistry.make().set(codePanelOpenAtom, true);
  const reloaded = AtomRegistry.make();
  assert.isTrue(reloaded.get(codePanelOpenAtom));
  reloaded.set(codePanelOpenAtom, false);
  assert.isFalse(AtomRegistry.make().get(codePanelOpenAtom));
});

it("opens to show what's opened in a Session's code panel", () => {
  vi.stubGlobal("localStorage", storage());
  const registry = AtomRegistry.make();
  registry.set(showInCodeAtom("s1"), { kind: "file", path: "/work/app/a.ts" });
  assert.isTrue(registry.get(codePanelOpenAtom));
  assert.deepStrictEqual(registry.get(openAtom("s1")), {
    kind: "file",
    path: "/work/app/a.ts",
  });
  assert.strictEqual(registry.get(openAtom("s2")), undefined);
});

const key = (init: {
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  code: string;
}) => ({ metaKey: false, ctrlKey: false, altKey: false, ...init });

it("toggles on ⌘\\ alone", () => {
  assert.isTrue(isCodePanelToggle(key({ metaKey: true, code: "Backslash" })));
  assert.isFalse(isCodePanelToggle(key({ ctrlKey: true, code: "Backslash" })));
  assert.isFalse(
    isCodePanelToggle(key({ metaKey: true, altKey: true, code: "Backslash" })),
  );
  assert.isFalse(isCodePanelToggle(key({ metaKey: true, code: "Slash" })));
});
