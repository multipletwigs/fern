import { assert, layer } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { FernApi } from "@repo/api";
import { DateTime, Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VerifySlotsHandlers } from "../src/http";
import { VerifySlots, VerifySlotsDir } from "../src/verify/VerifySlots";

const makeClient = HttpApiTest.groups(FernApi, ["verifySlots"]);

// The endpoint on the real service, reading slots from `dir`.
const serving = (dir: string) =>
  Layer.mergeAll(
    VerifySlotsHandlers.pipe(
      Layer.provide(VerifySlots.layer),
      Layer.provide(Layer.succeed(VerifySlotsDir, dir)),
      Layer.provide(NodeServices.layer),
    ),
    HttpServer.layerServices,
  );

// A pid no process has any more: one that ran and exited.
const { pid: dead } = spawnSync(process.execPath, ["-e", ""]);
if (dead === undefined) throw new Error("couldn't run node");
const alive = process.pid;

// What `pnpm verify:up N` writes to ~/.fern/verify/N/slot.json.
const manifest = (n: number, pids: Record<string, number>) => ({
  slot: n,
  worktree: `/work/fern/.claude/worktrees/agent-${n}`,
  branch: `worktree-agent-${n}`,
  apiPort: 7430 + n,
  webPort: 5180 + n,
  pageUrl: `http://localhost:${5180 + n}`,
  pids,
  startedAt: "2026-10-12T09:00:00.000Z",
});

// A folder of slots, each with the manifest given, or none.
const slotsDir = (slots: Record<number, object | string | undefined>) => {
  const dir = mkdtempSync(join(tmpdir(), "fern-verify-"));
  for (const [n, content] of Object.entries(slots)) {
    mkdirSync(join(dir, n));
    if (content !== undefined)
      writeFileSync(
        join(dir, n, "slot.json"),
        typeof content === "string" ? content : JSON.stringify(content),
      );
  }
  return dir;
};

layer(serving(join(tmpdir(), "fern-verify-never-started")))(
  "No slot ever started",
  (it) => {
    it.effect("lists none", () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        assert.deepStrictEqual(yield* client.verifySlots.running(), []);
      }),
    );
  },
);

layer(
  serving(
    slotsDir({
      // Every process exited without `verify:down`: a stale manifest.
      2: manifest(2, { vite: dead, electron: dead }),
      // Still building, or stopped: no manifest.
      5: undefined,
      8: manifest(8, { vite: alive, electron: alive }),
      // The app crashed, but the page is still served.
      3: manifest(3, { vite: alive, electron: dead }),
    }),
  ),
)("Slots running and stopped", (it) => {
  it.effect(
    "lists the slots with a process running, by slot number, and which of their processes are",
    () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const slots = yield* client.verifySlots.running();
        assert.deepStrictEqual(
          slots.map((s) => s.slot),
          [3, 8],
        );
        const [three, eight] = slots;
        assert.deepStrictEqual(
          three?.processes.map((p) => [p.name, p.alive]),
          [
            ["vite", true],
            ["electron", false],
          ],
        );
        assert.strictEqual(eight?.branch, "worktree-agent-8");
        assert.strictEqual(
          eight?.worktree,
          "/work/fern/.claude/worktrees/agent-8",
        );
        assert.strictEqual(eight?.pageUrl, "http://localhost:5188");
        assert.strictEqual(eight?.apiPort, 7438);
        assert.strictEqual(
          eight && DateTime.formatIso(eight.startedAt),
          "2026-10-12T09:00:00.000Z",
        );
      }),
  );
});

const corrupt = slotsDir({
  1: manifest(1, { vite: alive }),
  4: "{ not json",
});
layer(serving(corrupt))("A manifest that isn't one", (it) => {
  it.effect("fails, naming the file", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.verifySlots.running().pipe(Effect.flip);
      assert.strictEqual(error._tag, "VerifySlotError");
      assert.include(error.message, join(corrupt, "4", "slot.json"));
    }),
  );
});
