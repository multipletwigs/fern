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
import { DEFAULT_FIXTURE, setUpGhShim } from "./gh-shim/setup.ts";
import { cloneWorktree } from "./repo.ts";
import { type SlotManifest, slotOf } from "./slot.ts";

// Starts an isolated Fern from this worktree: its own ports, userData and CLAUDE_CONFIG_DIR,
// seeded with the Subagent fixture in a throwaway clone of the worktree, and writes the slot's
// manifest. Not `pnpm dev`: its readiness check would pass on the developer's own page at 5173,
// and it can't pass `--user-data-dir`.
//
// --gh-shim [fixture]  puts the fake `gh` in gh-shim/ first on the slot's PATH, serving the
//                      fixture's PRs and Stacks (gh-shim/fixture.json by default).
// --claude-auth        lets the slot's Claude Code use the developer's own login, from the
//                      keychain, so Turns, Forks and Walkthroughs run, on real tokens.

const [slotArg, ...flags] = process.argv.slice(2);
const slot = slotOf(slotArg);
const root = resolve(import.meta.dirname, "../..");

let ghShim: string | undefined;
let claudeAuth = false;
for (let i = 0; i < flags.length; i++) {
  const flag = flags[i];
  if (flag === "--claude-auth") claudeAuth = true;
  else if (flag === "--gh-shim") {
    const next = flags[i + 1];
    // pnpm runs the script from the repo's root; a fixture is named from where it was run.
    ghShim =
      next === undefined || next.startsWith("--")
        ? DEFAULT_FIXTURE
        : resolve(process.env.INIT_CWD ?? process.cwd(), flags[++i] ?? "");
  } else {
    console.error(
      `Unknown flag ${flag}. Usage: pnpm verify:up <slot 1-9> [--gh-shim [fixture]] [--claude-auth]`,
    );
    process.exit(1);
  }
}
// Only whether the developer's login is there: its secret stays in the keychain.
if (
  claudeAuth &&
  process.platform === "darwin" &&
  spawnSync(
    "security",
    ["find-generic-password", "-s", "Claude Code-credentials"],
    {
      stdio: "ignore",
    },
  ).status !== 0
) {
  console.error(
    "--claude-auth: no Claude Code login in the keychain. Run `claude` and /login first.",
  );
  process.exit(1);
}
if (ghShim !== undefined && !existsSync(ghShim)) {
  console.error(`No gh shim fixture at ${ghShim}.`);
  process.exit(1);
}

const freeOn = (port: number, host: string) =>
  new Promise<boolean>((done) => {
    const server = createServer()
      .once("error", () => done(false))
      .once("listening", () => server.close(() => done(true)))
      .listen(port, host);
  });
// On both loopbacks: Vite listens on `::1` for `localhost`, and the readiness check below would
// pass on another worktree's Vite left there.
const free = async (port: number) =>
  (await freeOn(port, "127.0.0.1")) && (await freeOn(port, "::1"));

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
// The fixture Session runs in the clone, so the PR refs and worktrees Fern makes for it go into
// the clone's `.git`, never the developer's.
const origin = cloneWorktree(root, slot.repo);
writeFixture(slot.configDir, slot.repo);
const shim =
  ghShim === undefined
    ? undefined
    : setUpGhShim({
        fixturePath: ghShim,
        origin,
        clone: slot.repo,
        remote: slot.remote,
        served: slot.ghFixture,
      });

const desktop = join(root, "apps/desktop");
const built = spawnSync("pnpm", ["exec", "tsdown"], {
  cwd: desktop,
  stdio: "inherit",
});
if (built.status !== 0) process.exit(built.status ?? 1);

// Claude Code's own login is in the keychain, under a name it takes from CLAUDE_CONFIG_DIR, so
// the slot's config dir has none. CLAUDE_SECURESTORAGE_CONFIG_DIR, set empty, has it read and
// refresh the developer's own instead, sharing their lock on it, while Sessions stay in the slot.
// Without --claude-auth, no login the developer's environment holds reaches the slot.
const inherited = { ...process.env };
if (!claudeAuth)
  for (const login of [
    "CLAUDE_SECURESTORAGE_CONFIG_DIR",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
  ])
    delete inherited[login];
const env = {
  ...inherited,
  FERN_API_PORT: String(slot.apiPort),
  FERN_WEB_PORT: String(slot.webPort),
  CLAUDE_CONFIG_DIR: slot.configDir,
  ...(claudeAuth ? { CLAUDE_SECURESTORAGE_CONFIG_DIR: "" } : {}),
  ...(shim === undefined
    ? {}
    : {
        PATH: `${join(import.meta.dirname, "gh-shim", "bin")}:${process.env.PATH ?? ""}`,
        FERN_GH_SHIM_FIXTURE: slot.ghFixture,
        FERN_GH_SHIM_WRITES: slot.ghWrites,
      }),
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
  console.error(
    `${message}; the end of ${slot.logs}/${name}.log:\n${tail(name)}`,
  );
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
  if (!alive(pids.electron)) fail("Electron exited", "electron", [pids.vite]);
  if (Date.now() > deadline)
    fail("Fern didn't come up", "electron", Object.values(pids));
  await sleep(500);
}
if (!alive(pids.electron)) fail("Electron exited", "electron", [pids.vite]);

console.log(`Isolated Fern, slot ${slot.n}:
  page     ${manifest.pageUrl}
  browser  export AGENT_BROWSER_SESSION=${slot.browserSession}
  fixture  Session ${FIXTURE_SESSION} in ${slot.configDir}
  repo     ${slot.repo} (a clone of this worktree, the fixture Session's cwd)
  gh       ${shim === undefined ? "the real gh" : `the shim, ${shim.prs.length} PRs of ${shim.repo} from ${ghShim}; writes go to ${slot.ghWrites}`}
  claude   ${claudeAuth ? "the developer's own login: Turns spend real tokens" : "signed out"}
  logs     ${slot.logs}
  manifest ${slot.manifest}
  stop     pnpm verify:down ${slot.n}`);
