import { NodeServices } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { LiveRpcs, type SessionChanges } from "@repo/api";
import { Effect, Layer, Stream } from "effect";
import { HttpServer } from "effect/http";
import { RpcTest } from "effect/rpc";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import { Snapshots } from "../src/snapshot/Snapshots";
import { NoWorktreesDir, NoWriter } from "./stubs";

// A committed repo with uncommitted work in it already, and a Session that ran in its `app` folder.
const repo = realpathSync(mkdtempSync(join(tmpdir(), "fern-changes-")));
const git = (...args: Array<string>) =>
  execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd: repo, encoding: "utf8" },
  );
git("init", "-q");
mkdirSync(join(repo, "app"));
writeFileSync(join(repo, "app", "a.ts"), "one\ntwo\nthree\n");
writeFileSync(join(repo, "root.txt"), "outside the folder\n");
git("add", "-A");
git("commit", "-q", "-m", "Initial");
writeFileSync(join(repo, "app", "a.ts"), "one\n2\nthree\n");
const root = join(repo, "app");

const SESSION = "0b5c9e7a-3d21-4f8e-a6b4-9c2d1e0f3a5b";
const configDir = mkdtempSync(join(tmpdir(), "fern-claude-"));
const projectDir = join(
  configDir,
  "projects",
  root.replace(/[^a-zA-Z0-9]/g, "-"),
);
mkdirSync(projectDir, { recursive: true });
writeFileSync(
  join(projectDir, `${SESSION}.jsonl`),
  `${JSON.stringify({
    type: "user",
    uuid: "00000000-0000-4000-8000-000000000001",
    parentUuid: null,
    sessionId: SESSION,
    timestamp: "2026-10-11T10:00:00.000Z",
    cwd: root,
    message: { role: "user", content: "Write a demo file" },
  })}\n`,
);
process.env.CLAUDE_CONFIG_DIR = configDir;

const makeLive = RpcTest.makeClient(LiveRpcs);

const changes = Effect.gen(function* () {
  const live = yield* makeLive;
  const [first] = yield* live
    .Changes({ root, session: SESSION })
    .pipe(Stream.take(1), Stream.runCollect);
  return first;
});

const counts = (result: SessionChanges | undefined) =>
  result?.files.map(({ path, added, removed }) => [path, added, removed]);

layer(
  Layer.mergeAll(
    handlersWith(NoWriter).pipe(
      Layer.provide([DatabaseLive(":memory:"), NoWorktreesDir]),
    ),
    Snapshots.layer.pipe(Layer.provide(NodeServices.layer)),
    HttpServer.layerServices,
  ),
)("Session changes", (it) => {
  it.effect(
    "falls back to the uncommitted change, inside the folder only",
    () =>
      Effect.gen(function* () {
        const result = yield* changes;
        assert.strictEqual(result?.since, "head");
        assert.deepStrictEqual(counts(result), [["a.ts", 1, 1]]);
      }),
  );

  it.effect("counts the net change since the Session started", () =>
    Effect.gen(function* () {
      const snapshots = yield* Snapshots;
      yield* snapshots.markStart(repo, SESSION);
      // Written, then edited, as the demo file was: 9 lines in the end.
      mkdirSync(join(root, "docs"));
      writeFileSync(join(root, "docs", "demo.md"), "1\n2\n3\n4\n5\n6\n7\n");
      writeFileSync(
        join(root, "docs", "demo.md"),
        "1\n2\n3\n4\n5\n6\n7\n8\n9\n",
      );
      const result = yield* changes;
      assert.strictEqual(result?.since, "start");
      // a.ts was already changed when the Session started, so it isn't the Session's change.
      assert.deepStrictEqual(counts(result), [["docs/demo.md", 9, 0]]);
    }),
  );
});
