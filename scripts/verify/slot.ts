import { tmpdir } from "node:os";
import { join } from "node:path";

// Everything one isolated Fern uses, from its slot number. Slots keep parallel agents apart, and
// none of them can land on the developer's own Fern (API 7420, page 5173).

export const slotOf = (arg: string | undefined) => {
  const n = Number(arg);
  if (!Number.isInteger(n) || n < 1 || n > 9) {
    console.error(
      "Usage: pnpm verify:up <slot 1-9> | pnpm verify:down <slot 1-9>",
    );
    process.exit(1);
  }
  const dir = join(tmpdir(), "fern-verify", String(n));
  return {
    n,
    apiPort: 7430 + n,
    webPort: 5180 + n,
    dir,
    userData: join(dir, "userdata"),
    configDir: join(dir, "claude-config"),
    logs: dir,
    pids: join(dir, "pids.json"),
    browserSession: `fern-verify-${n}`,
  };
};
