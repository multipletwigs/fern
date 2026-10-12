import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Every state is declared once, in packages/api/src/States.ts, and imported everywhere else. This
// flags a string-literal union, or a Schema.Literals, given to a state-like name anywhere else:
// a status, state, verdict, mode, kind or outcome. Run by `pnpm lint`.

const root = join(import.meta.dirname, "..");
const HOME = "packages/api/src/States.ts";
const SKIP = new Set(["node_modules", "dist", "release", ".turbo"]);

const STATE_NAME = /(status|state|verdict|mode|kind|outcome)$/i;
// `status: "a" | "b"`, also across lines and with a leading `|`.
const FIELD_UNION = /(\w+)\??\s*:\s*\|?\s*"[^"\n]*"\s*\|\s*"/g;
// `type FooStatus = "a" | "b"`.
const TYPE_UNION = /type\s+(\w+)\s*=\s*\|?\s*"[^"\n]*"\s*\|\s*"/g;
// `status: Schema.Literals([`, `verdict: Schema.NullOr(Schema.Literals([`, `const FooStatus = …`.
const LITERALS = /(\w+)\??\s*[:=]\s*(?:Schema\.\w+\(\s*)*Schema\.Literals\(/g;
// `useState<"a" | "b">`, whatever it's called.
const USE_STATE = /useState<\s*\|?\s*"[^"\n]*"\s*\|/g;

const files = (dir: string): Array<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

const found: Array<string> = [];
for (const path of ["apps", "packages"].flatMap((d) => files(join(root, d)))) {
  const file = relative(root, path);
  if (file === HOME) continue;
  const text = readFileSync(path, "utf8");
  const flag = (index: number, what: string) => {
    const line = text.slice(0, index).split("\n").length;
    found.push(`${file}:${line}: ${what}`);
  };
  for (const pattern of [FIELD_UNION, TYPE_UNION, LITERALS])
    for (const match of text.matchAll(pattern))
      if (STATE_NAME.test(match[1] ?? ""))
        flag(match.index, `\`${match[1]}\` declares a state`);
  for (const match of text.matchAll(USE_STATE))
    flag(match.index, "useState declares a state");
}

if (found.length > 0) {
  console.error(
    [
      ...found,
      "",
      `States live in ${HOME}: declare the state there and import it.`,
    ].join("\n"),
  );
  process.exit(1);
}
