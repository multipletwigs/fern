import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { build } from "tsdown";

// `pnpm dev` for the desktop app. Fern is often used to edit Fern, so a rebuild must never take
// the running app down with it:
// - it waits until no turn is running, so Claude's edit doesn't kill the turn making it;
// - it skips restarting into a build with type errors, keeping the running app instead;
// - if a new build still fails to start, it falls back to the last build that did.

const API = `http://127.0.0.1:${process.env.FERN_API_PORT ?? 7420}/api`;
const BUILD = "dist/main.mjs";
const LAST_GOOD = ".dev/last-good.mjs";
const START_TIMEOUT_MS = 20_000;

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
const launch = (entry: string) => {
  app = spawn("electron", [entry, "--dev"], { stdio: "inherit" });
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
  if (await startsHealthy(launch("."))) {
    await mkdir(".dev", { recursive: true });
    await copyFile(BUILD, LAST_GOOD);
    return;
  }
  await stop();
  if (!existsSync(LAST_GOOD)) {
    console.error(
      "[dev] The new build didn't start; waiting for the next rebuild.",
    );
    return;
  }
  console.error(
    "[dev] The new build didn't start; running the last good build until the next rebuild.",
  );
  launch(LAST_GOOD);
};

await build({
  watch: true,
  onSuccess: async (_config, signal) => {
    await waitForIdle(signal);
    if (signal.aborted) return;
    if (isUp(app) && !(await typechecks())) {
      console.error(
        "[dev] Type errors; keeping the running app. Fix them to restart.",
      );
      return;
    }
    // A newer build replaced this one and will do the restart itself.
    if (!signal.aborted) await restart();
  },
});
