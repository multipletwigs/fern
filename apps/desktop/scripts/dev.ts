import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { build } from "tsdown";

// `pnpm dev` for the desktop app. Fern is often used to edit Fern, so a rebuild must never take
// the running app down with it:
// - it waits until no turn is running, so Claude's edit doesn't kill the turn making it;
// - it skips restarting into a build with type errors, keeping the running app instead.
// A build that type-checks but doesn't start is reported and left down until the next change.
//
// It builds once per change, found by polling the sources' mtimes: rolldown's watch mode finishes
// without ever writing the bundle, and macOS file events run out with several dev servers up.

const API = `http://127.0.0.1:${process.env.FERN_API_PORT ?? 7420}/api`;
const SOURCES = ["src", "../../packages/server/src", "../../packages/api/src"];
const START_TIMEOUT_MS = 20_000;
const POLL_MS = 400;

let app: ChildProcess | undefined;

const isUp = (child: ChildProcess | undefined): child is ChildProcess =>
  child !== undefined && child.exitCode === null && child.signalCode === null;

const get = async (path: string) => {
  try {
    return await fetch(`${API}${path}`, { signal: AbortSignal.timeout(1000) });
  } catch {
    return undefined;
  }
};

const runningTurns = async () => {
  const response = await get("/sessions/running");
  // Not up yet, or crashed: there's no turn to protect.
  const running: unknown = response?.ok ? await response.json() : [];
  return Array.isArray(running) ? running.length : 0;
};

const waitForIdle = async (signal: AbortSignal) => {
  let told = false;
  while (!signal.aborted && (await runningTurns()) > 0) {
    if (!told)
      console.log("[dev] Rebuilt; restarting once Fern's turn finishes.");
    told = true;
    await sleep(1000);
  }
};

// Type errors in the main process, server, or API usually mean the new build won't start.
const typechecks = () =>
  new Promise<boolean>((resolve) => {
    const tsc = spawn("tsc", ["--noEmit"], { stdio: "inherit" });
    tsc.once("exit", (code) => resolve(code === 0));
  });

const stop = async () => {
  if (!isUp(app)) return;
  const exited = once(app, "exit");
  app.kill("SIGTERM");
  await exited;
};

// `pnpm dev` puts the electron CLI on PATH; it forwards SIGTERM to the app.
const launch = () => {
  app = spawn("electron", [".", "--dev"], { stdio: "inherit" });
  return app;
};

// Whether the app comes up and serves its API before exiting or timing out.
const startsHealthy = async (child: ChildProcess) => {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline && isUp(child)) {
    if ((await get("/health"))?.ok) return true;
    await sleep(500);
  }
  return false;
};

const restart = async () => {
  await stop();
  if (await startsHealthy(launch())) return;
  await stop();
  console.error(
    "[dev] The new build didn't start (see its output above); waiting for the next change.",
  );
};

// Builds and restarts. A change that lands meanwhile aborts what's left, and its own run takes
// over once this build is written.
let current: AbortController | undefined;
let building: Promise<unknown> = Promise.resolve();

const rebuild = () => {
  current?.abort();
  const controller = new AbortController();
  current = controller;
  const { signal } = controller;
  building = building.then(async () => {
    if (signal.aborted) return;
    try {
      await build({ watch: false });
    } catch (error) {
      console.error("[dev] Build failed; keeping the running app.", error);
      return;
    }
    await waitForIdle(signal);
    if (signal.aborted) return;
    if (isUp(app) && !(await typechecks())) {
      console.error(
        "[dev] Type errors; keeping the running app. Fix them to restart.",
      );
      return;
    }
    if (!signal.aborted) await restart();
  });
};

// Every source file with its mtime, so an edit, a new file and a deleted one all change it.
const snapshot = async () => {
  const entries = await Promise.all(
    SOURCES.map(async (dir) => {
      const files = await readdir(dir, { recursive: true });
      return Promise.all(
        files.map(async (file) => {
          const path = join(dir, file);
          const info = await stat(path).catch(() => undefined);
          return info?.isFile() ? `${path}:${info.mtimeMs}` : "";
        }),
      );
    }),
  );
  return entries.flat().toSorted().join("\n");
};

let seen = await snapshot();
rebuild();
for (;;) {
  await sleep(POLL_MS);
  const now = await snapshot();
  if (now !== seen) {
    seen = now;
    rebuild();
  }
}
