import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { type SlotManifest, slotOf } from "./slot.ts";

// Stops only the processes `pnpm verify:up` started for this slot, by their process groups,
// removes its manifest, and deletes its clone of the worktree.

const slot = slotOf(process.argv[2]);

spawnSync("agent-browser", ["close"], {
  env: { ...process.env, AGENT_BROWSER_SESSION: slot.browserSession },
  stdio: "ignore",
});

const alive = (pid: number) => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
};

if (existsSync(slot.manifest)) {
  const manifest: SlotManifest = JSON.parse(
    readFileSync(slot.manifest, "utf8"),
  );
  const pids = Object.values(manifest.pids);
  for (const pid of pids) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  // So nothing is still writing to the clone when it goes.
  const deadline = Date.now() + 5000;
  while (pids.some(alive) && Date.now() < deadline) await sleep(100);
  rmSync(slot.manifest);
}
rmSync(slot.repo, { recursive: true, force: true });
rmSync(slot.remote, { recursive: true, force: true });
console.log(`Stopped slot ${slot.n} and deleted its clone.`);
