import type { SessionChanges, TranscriptItem } from "@repo/api";

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
  // The net lines added and removed, from git; both 0 until git answers.
  readonly added: number;
  readonly removed: number;
}

const touchedFile = (root: string, path: string): ChangedFile => ({
  path,
  relative: path.slice(root.length + 1),
  added: 0,
  removed: 0,
});

// Every file inside the Project that the Session changed, with its net line counts from git, in
// the order Claude first changed them; changes it made some other way, such as through Bash, come
// after. A Session Fern never ran is compared with the last commit, which can hold other
// uncommitted work, so only the files its own Edit and Write calls touched are kept.
export const changedFiles = (
  items: ReadonlyArray<TranscriptItem>,
  root: string,
  changes: SessionChanges | undefined,
): ReadonlyArray<ChangedFile> => {
  const touched = [...new Set(edits(items, root).map((edit) => edit.path))];
  if (changes === undefined)
    return touched.map((path) => touchedFile(root, path));
  const counted = new Map(
    changes.files.map((file) => {
      const path = `${root}/${file.path}`;
      return [
        path,
        { path, relative: file.path, added: file.added, removed: file.removed },
      ] as const;
    }),
  );
  const first = touched.map(
    (path) => counted.get(path) ?? touchedFile(root, path),
  );
  if (changes.since === "head") return first;
  const seen = new Set(touched);
  return [
    ...first,
    ...[...counted.values()].filter((file) => !seen.has(file.path)),
  ];
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
  changes: ReadonlyArray<ChangedFile>,
) => {
  const changed = new Set(changes.map((file) => file.path));
  const byPath = new Map<string, ReadFile>();
  for (const item of items) {
    if (item._tag !== "ToolCall" || item.path === undefined) continue;
    const relative = relativeTo(root, item.path);
    if (relative !== undefined && !changed.has(item.path))
      byPath.set(item.path, { path: item.path, relative });
  }
  return [...byPath.values()];
};
