import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { slotOf } from "./slot.ts";

// Stops only the processes `pnpm verify:up` started for this slot, by their process groups.

const slot = slotOf(process.argv[2]);

spawnSync("agent-browser", ["close"], {
  env: { ...process.env, AGENT_BROWSER_SESSION: slot.browserSession },
  stdio: "ignore",
});

if (existsSync(slot.pids)) {
  const pids: Record<string, number | undefined> = JSON.parse(
    readFileSync(slot.pids, "utf8"),
  );
  for (const pid of Object.values(pids)) {
    if (pid === undefined) continue;
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  rmSync(slot.pids);
}
console.log(`Stopped slot ${slot.n}.`);
