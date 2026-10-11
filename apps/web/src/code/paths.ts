import type { TranscriptItem } from "@repo/api";

// A path relative to the Project's folder, or undefined when it's outside it.
export const relativeTo = (root: string, path: string) =>
  path.startsWith(`${root}/`) ? path.slice(root.length + 1) : undefined;

// The file Claude last read or changed inside the Project, as an absolute path.
export const followedFile = (
  items: ReadonlyArray<TranscriptItem>,
  root: string,
) => {
  for (const item of items.toReversed())
    if (
      item._tag === "ToolCall" &&
      item.path !== undefined &&
      relativeTo(root, item.path) !== undefined
    )
      return item.path;
  return undefined;
};
