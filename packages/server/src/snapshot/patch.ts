// Splits `git diff` patch output into hunks. A file change with no hunk of its own, such as a binary
// file or a new empty one, becomes one hunk describing it, so every changed file can be claimed.

export interface PatchHunk {
  // Relative to the repository's root.
  readonly path: string;
  readonly header: string;
  readonly lines: ReadonlyArray<string>;
  readonly added: number;
  readonly removed: number;
}

// Git quotes paths with unusual characters, C-style.
const unquote = (path: string) => {
  if (!path.startsWith('"')) return path;
  try {
    const parsed: unknown = JSON.parse(path);
    return typeof parsed === "string" ? parsed : path.slice(1, -1);
  } catch {
    return path.slice(1, -1);
  }
};

// "a/src/x.ts" -> "src/x.ts"; undefined for /dev/null.
const sidePath = (raw: string) => {
  const path = unquote(raw.replace(/\t.*$/, ""));
  return path === "/dev/null" ? undefined : path.replace(/^[ab]\//, "");
};

// The new path from "diff --git a/x b/x", for file changes without ---/+++ lines.
const headerPath = (line: string) => {
  const rest = line.slice("diff --git ".length);
  const quoted = /^"(?:[^"\\]|\\.)*" ("(?:[^"\\]|\\.)*")$/.exec(rest);
  if (quoted?.[1]) return sidePath(quoted[1]);
  // Unquoted, both sides are the same path when nothing was renamed.
  const half = rest.slice(Math.floor(rest.length / 2) + 1);
  return sidePath(half);
};

interface FileState {
  path: string | undefined;
  meta: Array<string>;
  hunks: Array<PatchHunk>;
  current: { header: string; lines: Array<string> } | undefined;
}

const describe = (meta: ReadonlyArray<string>) => {
  if (meta.some((line) => line.startsWith("Binary files")))
    return "Binary file changed";
  if (meta.some((line) => line.startsWith("new file"))) return "New empty file";
  if (meta.some((line) => line.startsWith("deleted file")))
    return "Deleted empty file";
  if (meta.some((line) => line.startsWith("new mode"))) return "Mode changed";
  return "Changed";
};

const toHunk = (
  path: string,
  { header, lines }: { header: string; lines: ReadonlyArray<string> },
): PatchHunk => ({
  path,
  header,
  lines,
  added: lines.filter((line) => line.startsWith("+")).length,
  removed: lines.filter((line) => line.startsWith("-")).length,
});

export const parsePatch = (patch: string): ReadonlyArray<PatchHunk> => {
  const hunks: Array<PatchHunk> = [];
  let file: FileState | undefined;

  const closeHunk = () => {
    if (file?.current && file.path !== undefined)
      file.hunks.push(toHunk(file.path, file.current));
    if (file) file.current = undefined;
  };
  const closeFile = () => {
    closeHunk();
    if (!file || file.path === undefined) return;
    if (file.hunks.length === 0)
      file.hunks.push(
        toHunk(file.path, { header: describe(file.meta), lines: [] }),
      );
    hunks.push(...file.hunks);
  };

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      closeFile();
      file = {
        path: headerPath(line),
        meta: [],
        hunks: [],
        current: undefined,
      };
    } else if (!file) {
      continue;
    } else if (file.current) {
      if (
        line.startsWith(" ") ||
        line.startsWith("+") ||
        line.startsWith("-") ||
        line.startsWith("\\")
      )
        file.current.lines.push(line);
      else if (line.startsWith("@@")) {
        closeHunk();
        file.current = { header: line, lines: [] };
      }
    } else if (line.startsWith("@@")) {
      file.current = { header: line, lines: [] };
    } else if (line.startsWith("--- ")) {
      file.path = sidePath(line.slice(4)) ?? file.path;
    } else if (line.startsWith("+++ ")) {
      // The new side names the file, unless it was deleted.
      file.path = sidePath(line.slice(4)) ?? file.path;
    } else {
      file.meta.push(line);
    }
  }
  closeFile();
  return hunks;
};

export interface NumstatEntry {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly binary: boolean;
}

// `git diff --numstat -z` output: "added\tremoved\tpath\0", with "-" counts for a binary file.
export const parseNumstat = (output: string): ReadonlyArray<NumstatEntry> =>
  output
    .split("\0")
    .filter(Boolean)
    .flatMap((entry) => {
      const [added, removed, ...path] = entry.split("\t");
      if (added === undefined || removed === undefined) return [];
      const binary = added === "-";
      return [
        {
          path: path.join("\t"),
          added: binary ? 0 : Number(added),
          removed: binary ? 0 : Number(removed),
          binary,
        },
      ];
    });
