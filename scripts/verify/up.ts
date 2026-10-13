import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
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

const tail = (name: string) =>
  readFileSync(join(slot.logs, `${name}.log`), "utf8")
    .split("\n")
    .slice(-20)
    .join("\n");
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const fail = (message: string, name: string, running: Array<number>) => {
  console.error(`${message}; the end of ${slot.logs}/${name}.log:\n${tail(name)}`);
  for (const pid of running)
    try {
      process.kill(-pid, "SIGTERM");
    } catch {}
  process.exit(1);
};

// Electron opens its window on the page as soon as it starts, and quits if the page isn't there
// yet, so Vite has to be answering first.
const vite = start("vite", join(root, "apps/web"), [
  "vite",
  "--port",
  String(slot.webPort),
  "--strictPort",
]);
const serving = async () => {
  try {
    return (await fetch(`http://localhost:${slot.webPort}`)).ok;
  } catch {
    return false;
  }
};
const viteDeadline = Date.now() + 30_000;
while (!(await serving())) {
  if (!alive(vite)) fail("Vite exited", "vite", []);
  if (Date.now() > viteDeadline) fail("Vite didn't answer", "vite", [vite]);
  await sleep(250);
}

const pids = {
  vite,
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
// Up means the API answers, the window has loaded the page (the main process logs it), and
// Electron is still running: a server that answered before the window failed isn't a slot.
const loaded = () => tail("electron").includes("Fern window loaded");
const deadline = Date.now() + 30_000;
while (!(loaded() && (await healthy()))) {
  if (!alive(pids.electron))
    fail("Electron exited", "electron", [pids.vite]);
  if (Date.now() > deadline)
    fail("Fern didn't come up", "electron", Object.values(pids));
  await sleep(500);
}
if (!alive(pids.electron)) fail("Electron exited", "electron", [pids.vite]);

console.log(`Isolated Fern, slot ${slot.n}:
  page     ${manifest.pageUrl}
  browser  export AGENT_BROWSER_SESSION=${slot.browserSession}
  fixture  Session ${FIXTURE_SESSION} in ${slot.configDir}
  logs     ${slot.logs}
  manifest ${slot.manifest}
  stop     pnpm verify:down ${slot.n}`);
