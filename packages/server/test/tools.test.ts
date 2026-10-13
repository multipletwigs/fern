import { assert, layer } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { FernApi, ToolStatus } from "@repo/api";
import { Duration, Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SystemHandlers } from "../src/http";
import { ToolCheckTimeout, Tools } from "../src/tools/Tools";

const makeClient = HttpApiTest.groups(FernApi, ["system"]);

// `GET /tools` on the real service and the real spawner, giving up on a check after two seconds.
const serving = Layer.mergeAll(
  SystemHandlers.pipe(
    Layer.provide(Tools.layer),
    Layer.provide(Layer.succeed(ToolCheckTimeout, Duration.seconds(2))),
    Layer.provide(NodeServices.layer),
  ),
  HttpServer.layerServices,
);

// A folder of stub tools, each a shell script; only shell builtins and absolute paths work inside
// one, as PATH is this folder alone.
const stubs = (scripts: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "fern-tools-"));
  for (const [name, body] of Object.entries(scripts)) {
    const file = join(dir, name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
  }
  return dir;
};

const claude = `echo "2.1.296 (Claude Code)"`;
const git = `echo "git version 2.50.1 (Apple Git-155)"`;
// `gh` signed in as `octocat`, as gh 2.99 prints it, with the gh-stack extension installed.
const gh = `
if [ "$1" = "stack" ]; then
  echo "gh stack version 0.1.0"
  exit 0
fi
if [ "$1" = "auth" ]; then
  echo "github.com"
  echo "  ✓ Logged in to github.com account octocat (keyring)"
  echo "  - Active account: true"
  exit 0
fi
echo "gh version 2.99.0 (2026-09-01)"
echo "https://github.com/cli/cli/releases/tag/v2.99.0"`;
// `gh` without the gh-stack extension, as gh 2.99 answers a command it doesn't know.
const ghWithoutStack = `
if [ "$1" = "stack" ]; then
  echo 'unknown command "stack" for "gh"' >&2
  exit 1
fi
if [ "$1" = "auth" ]; then
  echo "  ✓ Logged in to github.com account octocat (keyring)"
  exit 0
fi
echo "gh version 2.99.0 (2026-09-01)"`;
const ghSignedOut = `
if [ "$1" = "auth" ]; then
  echo "You are not logged into any GitHub hosts. To log in, run: gh auth login" >&2
  exit 1
fi
echo "gh version 2.99.0 (2026-09-01)"`;

// The tools' statuses with PATH set to `dir` while they're checked, as the server's own
// environment is what the checks run in.
const checkWith = (dir: string) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const path = process.env.PATH;
      process.env.PATH = dir;
      return path;
    }),
    () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        return yield* client.tools();
      }),
    (path) =>
      Effect.sync(() => {
        process.env.PATH = path;
      }),
  );

// The real clock, for the checks to time out on.
layer(serving, { excludeTestServices: true })("Tools", (it) => {
  it.effect("all ready, with versions and gh's account", () =>
    Effect.gen(function* () {
      const tools = yield* checkWith(stubs({ claude, gh, git }));
      assert.deepStrictEqual(tools, [
        new ToolStatus({ tool: "claude", state: "ready", version: "2.1.296" }),
        new ToolStatus({
          tool: "gh",
          state: "ready",
          version: "2.99.0",
          account: "octocat",
        }),
        new ToolStatus({ tool: "git", state: "ready", version: "2.50.1" }),
        new ToolStatus({ tool: "gh-stack", state: "ready", version: "0.1.0" }),
      ]);
    }),
  );

  it.effect(
    "gh without the gh-stack extension reports it missing, fixed by installing the extension",
    () =>
      Effect.gen(function* () {
        const tools = yield* checkWith(
          stubs({ claude, gh: ghWithoutStack, git }),
        );
        const status = tools.find((t) => t.tool === "gh-stack");
        assert.strictEqual(status?.state, "missing");
        assert.strictEqual(
          status?.fix?.command,
          "gh extension install github/gh-stack",
        );
        assert.strictEqual(tools.find((t) => t.tool === "gh")?.state, "ready");
      }),
  );

  it.effect("without gh, gh-stack is missing too, with where to get gh", () =>
    Effect.gen(function* () {
      const tools = yield* checkWith(stubs({ claude, git }));
      const status = tools.find((t) => t.tool === "gh-stack");
      assert.strictEqual(status?.state, "missing");
      assert.match(status?.fix?.url ?? "", /cli\.github\.com/);
    }),
  );

  it.effect("gh signed out needs attention, fixed by gh auth login", () =>
    Effect.gen(function* () {
      const tools = yield* checkWith(stubs({ claude, gh: ghSignedOut, git }));
      const status = tools.find((t) => t.tool === "gh");
      assert.strictEqual(status?.state, "needs-attention");
      assert.strictEqual(status?.version, "2.99.0");
      assert.strictEqual(status?.account, undefined);
      assert.strictEqual(status?.detail, "Not signed in to GitHub");
      assert.strictEqual(status?.fix?.command, "gh auth login");
    }),
  );

  it.effect("a tool not on PATH is missing, with where to install it", () =>
    Effect.gen(function* () {
      const tools = yield* checkWith(stubs({ gh, git }));
      assert.deepStrictEqual(
        tools.map((t) => t.tool),
        ["claude", "gh", "git", "gh-stack"],
      );
      const status = tools[0];
      assert.strictEqual(status?.state, "missing");
      assert.strictEqual(status?.version, undefined);
      assert.isString(status?.detail);
      assert.match(status?.fix?.url ?? "", /^https:\/\//);
      assert.strictEqual(tools[2]?.state, "ready");
    }),
  );

  it.effect("a check that runs past the timeout is unknown and says so", () =>
    Effect.gen(function* () {
      const tools = yield* checkWith(
        stubs({ claude, gh, git: "exec /bin/sleep 10" }),
      );
      const status = tools.find((t) => t.tool === "git");
      assert.strictEqual(status?.state, "unknown");
      assert.match(status?.detail ?? "", /didn't answer within 2s/);
      assert.strictEqual(tools[0]?.state, "ready");
    }),
  );
});
