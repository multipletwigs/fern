import { assert, it } from "@effect/vitest";
import { AtomRegistry } from "effect/reactivity";
import {
  newSessionAtom,
  settingsOpenAtom,
  showingAtom,
} from "../src/workspace/showing";

// What's right of the sidebar, as the sidebar, Settings and a new Session change it.

it("shows Settings in place of the Session on screen", () => {
  const registry = AtomRegistry.make();
  registry.set(settingsOpenAtom, true);
  assert.strictEqual(registry.get(showingAtom)._tag, "Settings");
  registry.set(settingsOpenAtom, false);
  assert.deepStrictEqual(registry.get(showingAtom), { _tag: "Session" });
});

it("puts Settings away when a new Session is started", () => {
  const registry = AtomRegistry.make();
  registry.set(settingsOpenAtom, true);
  registry.set(newSessionAtom, "/work/app");
  assert.isFalse(registry.get(settingsOpenAtom));
  assert.deepStrictEqual(registry.get(showingAtom), {
    _tag: "NewSession",
    root: "/work/app",
  });
});

it("puts Settings away when a Session is picked", () => {
  const registry = AtomRegistry.make();
  registry.set(newSessionAtom, "/work/app");
  registry.set(settingsOpenAtom, true);
  registry.set(newSessionAtom, undefined);
  assert.isFalse(registry.get(settingsOpenAtom));
  assert.deepStrictEqual(registry.get(showingAtom), { _tag: "Session" });
});

it("goes back from Settings to the new Session it was opened over", () => {
  const registry = AtomRegistry.make();
  registry.set(newSessionAtom, "/work/app");
  registry.set(settingsOpenAtom, true);
  assert.strictEqual(registry.get(newSessionAtom), "/work/app");
  registry.set(settingsOpenAtom, false);
  assert.deepStrictEqual(registry.get(showingAtom), {
    _tag: "NewSession",
    root: "/work/app",
  });
});
