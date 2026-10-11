import { FileGroup } from "@repo/ui/FileGroup";
import { FileRow } from "@repo/ui/FileRow";
import type { ChangedFile, ReadFile } from "./paths";

// The files Claude touched this Session: the ones it changed, then the ones it only read, folded
// away until asked for.
export function SessionFiles({
  changed,
  read,
  current,
  onPick,
}: {
  changed: ReadonlyArray<ChangedFile>;
  read: ReadonlyArray<ReadFile>;
  current: string | undefined;
  onPick: (path: string) => void;
}) {
  return (
    <div className="h-full space-y-px overflow-y-auto p-2">
      {changed.map((file) => (
        <FileRow
          key={file.path}
          path={file.relative}
          added={file.added}
          removed={file.removed}
          active={file.path === current}
          onSelect={() => onPick(file.path)}
        />
      ))}
      {read.length > 0 && (
        <FileGroup label="Read" count={read.length}>
          {read.map((file) => (
            <FileRow
              key={file.path}
              path={file.relative}
              active={file.path === current}
              onSelect={() => onPick(file.path)}
            />
          ))}
        </FileGroup>
      )}
    </div>
  );
}
