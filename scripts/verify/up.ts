import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { FIXTURE_SESSION, writeFixture } from "./fixture.ts";
import { type SlotManifest, slotOf } from "./slot.ts";

// Starts an isolated Fern from this worktree: its own ports, userData and CLAUDE_CONFIG_DIR,
// seeded with the Subagent fixture, and writes the slot's manifest. Not `pnpm dev`: its readiness
// check would pass on the developer's own page at 5173, and it can't pass `--user-data-dir`.

const slot = slotOf(process.argv[2]);
const root = resolve(import.meta.dirname, "../..");

const free = (port: number) =>
  new Promise<boolean>((done) => {
    const server = createServer()
      .once("error", () => done(false))
      .once("listening", () => server.close(() => done(true)))
      .listen(port, "127.0.0.1");
  });

for (const port of [slot.apiPort, slot.webPort])
  if (!(await free(port))) {
    console.error(
      `Port ${port} is taken: run \`pnpm verify:down ${slot.n}\` or pick another slot.`,
    );
    process.exit(1);
  }

// The branch the worktree has checked out, for the manifest; none on a detached HEAD.
const current = spawnSync("git", ["branch", "--show-current"], {
  cwd: root,
  encoding: "utf8",
});
if (current.status !== 0) {
  console.error(`Couldn't read the branch of ${root}:\n${current.stderr}`);
  process.exit(1);
}
const branch = current.stdout.trim() || null;

if (!existsSync(join(root, "node_modules")))
  spawnSync("pnpm", ["install", "--frozen-lockfile"], {
    cwd: root,
    stdio: "inherit",
  });

// A fresh userData keeps the instance from acting on the developer's Hosted Sessions: worktree
// cleanup and archiving only touch Sessions recorded in its own database.
rmSync(slot.dir, { recursive: true, force: true });
mkdirSync(slot.dir, { recursive: true });
writeFixture(slot.configDir, root);

const desktop = join(root, "apps/desktop");
const built = spawnSync("pnpm", ["exec", "tsdown"], {
  cwd: desktop,
  stdio: "inherit",
});
if (built.status !== 0) process.exit(built.status ?? 1);

const env = {
  ...process.env,
  FERN_API_PORT: String(slot.apiPort),
  FERN_WEB_PORT: String(slot.webPort),
  CLAUDE_CONFIG_DIR: slot.configDir,
};
const start = (name: string, cwd: string, args: Array<string>) => {
  const log = openSync(join(slot.logs, `${name}.log`), "a");
  const child = spawn("pnpm", ["exec", ...args], {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  if (child.pid === undefined) {
    console.error(`Couldn't start ${name}; see ${slot.logs}/${name}.log`);
    process.exit(1);
  }
  return child.pid;
};

const pids = {
  vite: start("vite", join(root, "apps/web"), [
    "vite",
    "--port",
    String(slot.webPort),
    "--strictPort",
  ]),
  electron: start("electron", desktop, [
    "electron",
    ".",
    "--dev",
    `--user-data-dir=${slot.userData}`,
  ]),
};
const manifest: SlotManifest = {
  slot: slot.n,
  worktree: root,
  branch,
  apiPort: slot.apiPort,
  webPort: slot.webPort,
  pageUrl: `http://localhost:${slot.webPort}`,
  pids,
  startedAt: new Date().toISOString(),
};
// Written whole, then moved into place, so a reader never sees half of it.
writeFileSync(`${slot.manifest}.tmp`, JSON.stringify(manifest, null, 2));
renameSync(`${slot.manifest}.tmp`, slot.manifest);

const healthy = async () => {
  try {
    const response = await fetch(`http://127.0.0.1:${slot.apiPort}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
};
const deadline = Date.now() + 30_000;
while (!(await healthy())) {
  if (Date.now() > deadline) {
    console.error(`Fern didn't come up; see ${slot.logs}/electron.log`);
    process.exit(1);
  }
  await sleep(500);
}

console.log(`Isolated Fern, slot ${slot.n}:
  page     ${manifest.pageUrl}
  browser  export AGENT_BROWSER_SESSION=${slot.browserSession}
  fixture  Session ${FIXTURE_SESSION} in ${slot.configDir}
  logs     ${slot.logs}
  manifest ${slot.manifest}
  stop     pnpm verify:down ${slot.n}`);
