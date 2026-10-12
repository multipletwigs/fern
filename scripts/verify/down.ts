import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { type SlotManifest, slotOf } from "./slot.ts";

// Stops only the processes `pnpm verify:up` started for this slot, by their process groups, and
// removes its manifest.

const slot = slotOf(process.argv[2]);

spawnSync("agent-browser", ["close"], {
  env: { ...process.env, AGENT_BROWSER_SESSION: slot.browserSession },
  stdio: "ignore",
});

if (existsSync(slot.manifest)) {
  const manifest: SlotManifest = JSON.parse(
    readFileSync(slot.manifest, "utf8"),
  );
  for (const pid of Object.values(manifest.pids)) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  rmSync(slot.manifest);
}
console.log(`Stopped slot ${slot.n}.`);
