import type { TranscriptItem } from "@repo/api";

// A path relative to the Project's folder, or undefined when it's outside it.
export const relativeTo = (root: string, path: string) =>
  path.startsWith(`${root}/`) ? path.slice(root.length + 1) : undefined;

type Edit = Extract<TranscriptItem, { _tag: "ToolCall" }> & {
  readonly path: string;
  readonly diff: ReadonlyArray<string>;
};

// Edit and Write calls on files inside the Project.
const edits = (items: ReadonlyArray<TranscriptItem>, root: string) =>
  items.filter(
    (item): item is Edit =>
      item._tag === "ToolCall" &&
      item.diff !== undefined &&
      item.path !== undefined &&
      relativeTo(root, item.path) !== undefined,
  );

// The file Claude last changed inside the Project, as an absolute path.
export const followedFile = (
  items: ReadonlyArray<TranscriptItem>,
  root: string,
) => edits(items, root).at(-1)?.path;

export interface ChangedFile {
  // Absolute, and inside the Project.
  readonly path: string;
  readonly relative: string;
  // Lines added and removed across Claude's edits.
  readonly added: number;
  readonly removed: number;
}

// Every file inside the Project that Claude changed, in the order it first changed them.
export const changedFiles = (
  items: ReadonlyArray<TranscriptItem>,
  root: string,
) => {
  const byPath = new Map<string, ChangedFile>();
  for (const { path, diff } of edits(items, root)) {
    const seen = byPath.get(path);
    const added = diff.filter((line) => line.startsWith("+")).length;
    byPath.set(path, {
      path,
      relative: path.slice(root.length + 1),
      added: (seen?.added ?? 0) + added,
      removed: (seen?.removed ?? 0) + diff.length - added,
    });
  }
  return [...byPath.values()];
};

export interface ReadFile {
  // Absolute, and inside the Project.
  readonly path: string;
  readonly relative: string;
}

// Every file inside the Project that Claude read but never changed, in the order it first read them.
export const readFiles = (
  items: ReadonlyArray<TranscriptItem>,
  root: string,
) => {
  const changed = new Set(edits(items, root).map((edit) => edit.path));
  const byPath = new Map<string, ReadFile>();
  for (const item of items) {
    if (item._tag !== "ToolCall" || item.path === undefined) continue;
    const relative = relativeTo(root, item.path);
    if (relative !== undefined && !changed.has(item.path))
      byPath.set(item.path, { path: item.path, relative });
  }
  return [...byPath.values()];
};
