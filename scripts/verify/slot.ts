import { homedir } from "node:os";
import { join } from "node:path";

// Everything one isolated Fern uses, from its slot number, all under ~/.fern/verify/N. Slots keep
// parallel agents apart, and none of them can land on the developer's own Fern (API 7420, page
// 5173).

export const slotOf = (arg: string | undefined) => {
  const n = Number(arg);
  if (!Number.isInteger(n) || n < 1 || n > 9) {
    console.error(
      "Usage: pnpm verify:up <slot 1-9> [--gh-shim [fixture]] [--claude-auth] | pnpm verify:down <slot 1-9>",
    );
    process.exit(1);
  }
  const dir = join(homedir(), ".fern", "verify", String(n));
  return {
    n,
    apiPort: 7430 + n,
    webPort: 5180 + n,
    dir,
    userData: join(dir, "userdata"),
    configDir: join(dir, "claude-config"),
    // A throwaway clone of the worktree, which the fixture Session runs in, so the PR refs and
    // worktrees Fern makes land in it, never in the developer's shared `.git`.
    repo: join(dir, "repo"),
    // With `--gh-shim`: the bare repo the clone's `origin` reaches instead of GitHub, the shim's
    // fixture with its commits filled in, and every write the shim was asked to make.
    remote: join(dir, "remote.git"),
    ghFixture: join(dir, "gh-fixture.json"),
    ghWrites: join(dir, "gh-writes.jsonl"),
    logs: dir,
    // What's running in the slot, for `verify:down` and for Fern's "Running" list: the slot's
    // worktree, branch, ports and processes. Only there while the slot is up.
    manifest: join(dir, "slot.json"),
    browserSession: `fern-verify-${n}`,
  };
};

// The manifest's shape. packages/server/src/verify/VerifySlots.ts reads it.
export interface SlotManifest {
  readonly slot: number;
  // The worktree's root, which the slot runs from.
  readonly worktree: string;
  // Null on a detached HEAD.
  readonly branch: string | null;
  readonly apiPort: number;
  readonly webPort: number;
  readonly pageUrl: string;
  // Each process's pid, which leads its process group.
  readonly pids: Readonly<Record<string, number>>;
  // ISO 8601.
  readonly startedAt: string;
}
