import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// A Foreign PR's checkout is untrusted: a relative `core.hooksPath`, as husky sets it, finds hooks
// among the PR's own files, and its .gitattributes pick which of the developer's filters run. So
// Fern's Foreign PR code reaches git only through PrWorktrees, whose `run` adds `NO_HOOKS` and the
// filter overrides to every call (docs/untrusted-checkouts.md). Run by `pnpm lint`.
//
// Scope: every file under packages/server/src/pullrequest/ and packages/server/src/walkthrough/,
// except PrWorktrees.ts, the wrapper itself. A raw git call there is any of:
// - a value import of the `Git` service, or of `Snapshots`, which runs git unguarded;
// - an import of a way to spawn a process: child_process, effect/process, a Command module;
// - "git" as a command: `"git",` as an argument, or `spawn("git …"`, `make\`git …\``.
// `import type { GitError }` is fine: it runs nothing.
//
// Walkthroughs.ts is allowed `Snapshots`, its one exception: its Session paths need it, and its
// Foreign PR path, `prepareForeign`, shares it to read and pin the PR's commits in the Project's
// checkout (`change.project`), never the PR's worktree (`change.cwd`). Lint can't tell which
// folder a call gets, so that one stays a review rule.

const root = join(import.meta.dirname, "..");
const SCOPE = [
  "packages/server/src/pullrequest",
  "packages/server/src/walkthrough",
];
const WRAPPER = "packages/server/src/pullrequest/PrWorktrees.ts";
const SNAPSHOTS_ALLOWED = new Set([
  "packages/server/src/walkthrough/Walkthroughs.ts",
]);

const files = (dir: string): Array<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

// Comments blanked out, keeping every line where it was.
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, " "));

// `import … from "x"`, with what it binds.
const IMPORT = /\bimport\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
// `import("x")` and `require("x")`.
const DYNAMIC = /\b(?:import|require)\s*\(\s*["']([^"']+)["']/g;
const SPAWNS =
  /(?:^|:)child_process$|^effect\/(?:unstable\/)?process\b|ChildProcess|(?:^|\/)Command$|^(?:execa|cross-spawn|zx)$/;
const GIT_ARG = /["'`]git["'`]\s*,/g;
const GIT_LINE =
  /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|make|run)\s*(?:\(\s*)?["'`]git\b/g;

// The names an import binds as values: `type` ones left out.
const values = (clause: string) =>
  clause
    .replace(/[{}]/g, ",")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "" && !name.startsWith("type "))
    .map((name) => name.split(/\s+as\s+/)[0]?.replace(/^\*\s*/, "") ?? "");

const found = new Set<string>();
for (const path of SCOPE.flatMap((d) => files(join(root, d)))) {
  const file = relative(root, path);
  if (file === WRAPPER) continue;
  const text = code(readFileSync(path, "utf8"));
  const flag = (index: number, what: string) => {
    const line = text.slice(0, index).split("\n").length;
    found.add(`${file}:${line}: ${what}`);
  };
  for (const match of text.matchAll(IMPORT)) {
    const [, typeOnly, clause = "", from = ""] = match;
    if (typeOnly) continue;
    const bound = values(clause);
    if (/(?:^|\/)git\/Git$/.test(from) && bound.includes("Git"))
      flag(match.index, "imports the Git service");
    if (
      /(?:^|\/)snapshot\/Snapshots$/.test(from) &&
      bound.includes("Snapshots") &&
      !SNAPSHOTS_ALLOWED.has(file)
    )
      flag(match.index, "imports Snapshots, which runs git unguarded");
    if (SPAWNS.test(from) && bound.length > 0)
      flag(match.index, `imports ${from}`);
  }
  for (const match of text.matchAll(DYNAMIC))
    if (SPAWNS.test(match[1] ?? "")) flag(match.index, `imports ${match[1]}`);
  for (const pattern of [GIT_ARG, GIT_LINE])
    for (const match of text.matchAll(pattern)) flag(match.index, "runs git");
}

if (found.size > 0) {
  console.error(
    [
      ...found,
      "",
      `Foreign PR code runs git only through PrWorktrees (${WRAPPER}), which runs no hooks or filters the PR brings. See docs/untrusted-checkouts.md.`,
    ].join("\n"),
  );
  process.exit(1);
}
