import { assert, layer } from "@effect/vitest";
import { FernApi, LiveRpcs } from "@repo/api";
import { Effect, Layer, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { RpcTest } from "effect/rpc";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import { NoWriter } from "./stubs";

// A git repo a Session ran in, with a tracked file, an ignored file, and a binary one.
const repo = realpathSync(mkdtempSync(join(tmpdir(), "fern-repo-")));
execFileSync("git", ["init", "-q"], { cwd: repo });
writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
writeFileSync(join(repo, "ignored.txt"), "secret");
mkdirSync(join(repo, "src"));
writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
writeFileSync(join(repo, "bin.dat"), Buffer.from([1, 0, 2]));

const SESSION = "6c0f6a8e-2c7a-4d43-9d5c-1c8d6a1f0b11";
const configDir = mkdtempSync(join(tmpdir(), "fern-claude-"));
const projectDir = join(
  configDir,
  "projects",
  repo.replace(/[^a-zA-Z0-9]/g, "-"),
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
    cwd: repo,
    message: { role: "user", content: "Show me the code" },
  })}\n`,
);
process.env.CLAUDE_CONFIG_DIR = configDir;

const makeClient = HttpApiTest.groups(FernApi, ["projects"]);
const makeLive = RpcTest.makeClient(LiveRpcs);

const first = <A, E>(stream: Stream.Stream<A, E>) =>
  stream.pipe(
    Stream.take(1),
    Stream.runCollect,
    Effect.map(([a]) => a),
  );

layer(
  Layer.mergeAll(
    handlersWith(NoWriter).pipe(Layer.provide(DatabaseLive(":memory:"))),
    HttpServer.layerServices,
  ),
)("Projects API", (it) => {
  it.effect("lists the files git doesn't ignore", () =>
    Effect.gen(function* () {
      const live = yield* makeLive;
      const files = yield* first(live.ProjectFiles({ root: repo }));
      assert.deepStrictEqual(files, [".gitignore", "bin.dat", "src/a.ts"]);
    }),
  );

  it.effect("streams a file's content", () =>
    Effect.gen(function* () {
      const live = yield* makeLive;
      const file = yield* first(live.File({ root: repo, path: "src/a.ts" }));
      assert.strictEqual(file?.content, "export const a = 1;\n");
      assert.strictEqual(file?.skipped, undefined);
    }),
  );

  it.effect("leaves out binary content", () =>
    Effect.gen(function* () {
      const live = yield* makeLive;
      const file = yield* first(live.File({ root: repo, path: "bin.dat" }));
      assert.strictEqual(file?.skipped, "binary");
      assert.strictEqual(file?.content, "");
    }),
  );

  it.effect("won't read outside the project", () =>
    Effect.gen(function* () {
      const live = yield* makeLive;
      const error = yield* first(
        live.File({ root: repo, path: "../../etc/hosts" }),
      ).pipe(Effect.flip);
      assert.strictEqual(error._tag, "FileNotFound");
    }),
  );

  it.effect("won't read folders no Session ran in", () =>
    Effect.gen(function* () {
      const live = yield* makeLive;
      const error = yield* first(live.ProjectFiles({ root: tmpdir() })).pipe(
        Effect.flip,
      );
      assert.strictEqual(error._tag, "ProjectNotFound");
    }),
  );

  it.effect("won't list commands for folders no Session ran in", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.projects
        .commands({ query: { root: tmpdir() } })
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "ProjectNotFound");
    }),
  );
});
