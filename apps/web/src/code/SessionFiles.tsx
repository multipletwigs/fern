import { CommitRow } from "@repo/ui/CommitRow";
import { FileGroup } from "@repo/ui/FileGroup";
import { FileRow } from "@repo/ui/FileRow";
import type { ReactNode } from "react";
import type { SessionCommit } from "./commits";
import type { ChangedFile, ReadFile } from "./paths";

// The files Claude touched this Session: the ones it changed, then the commits it made and the
// files it only read, each folded away until asked for. `header` sits above them all.
export function SessionFiles({
  header,
  changed,
  commits,
  read,
  current,
  onPick,
}: {
  header?: ReactNode;
  changed: ReadonlyArray<ChangedFile>;
  commits: ReadonlyArray<SessionCommit>;
  read: ReadonlyArray<ReadFile>;
  current: string | undefined;
  onPick: (path: string) => void;
}) {
  return (
    <div className="h-full space-y-0.5 overflow-y-auto p-2">
      {header}
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
      {commits.length > 0 && (
        <FileGroup label="Commits" count={commits.length}>
          {commits.map((commit) => (
            <CommitRow
              key={commit.id}
              subject={commit.subject}
              hash={commit.hash}
            />
          ))}
        </FileGroup>
      )}
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
