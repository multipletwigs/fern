import { useAtom, useAtomValue } from "@effect/atom-react";
import { Empty } from "@repo/ui/Empty";
import { FilePicker } from "@repo/ui/FilePicker";
import { PanelBar } from "@repo/ui/PanelBar";
import { AsyncResult } from "effect/reactivity";
import { projectFilesAtom } from "./atoms";
import { type OpenItem, openAtom } from "./panel";
import { OpenFile } from "./OpenFile";
import type { SessionCommit } from "./commits";
import { type ChangedFile, type ReadFile, relativeTo } from "./paths";
import { SessionFiles } from "./SessionFiles";

// The code panel for one Session: the files Claude touched beside what's open. That's what the
// developer picked, or else it follows Claude, showing the file it last changed.
export function ProjectCode({
  sessionId,
  root,
  changed,
  commits,
  read,
  followed,
}: {
  sessionId: string;
  root: string;
  changed: ReadonlyArray<ChangedFile>;
  commits: ReadonlyArray<SessionCommit>;
  read: ReadonlyArray<ReadFile>;
  // The file Claude last changed, as an absolute path.
  followed: string | undefined;
}) {
  const files = useAtomValue(projectFilesAtom(root));
  const [picked, pick] = useAtom(openAtom(sessionId));
  const following: OpenItem | undefined =
    followed !== undefined ? { kind: "file", path: followed } : undefined;
  const open = picked ?? following;
  // Picking what Claude would show anyway goes back to following Claude.
  const choose = (item: OpenItem) =>
    pick(item.path === following?.path ? undefined : item);

  const path = open ? relativeTo(root, open.path) : undefined;

  return (
    <div className="flex h-full flex-col">
      <PanelBar
        start={
          <FilePicker
            files={AsyncResult.isSuccess(files) ? files.value : []}
            current={path}
            onPick={(relative) =>
              choose({ kind: "file", path: `${root}/${relative}` })
            }
          />
        }
      />
      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 bg-side-panel">
          <SessionFiles
            changed={changed}
            commits={commits}
            read={read}
            current={open?.path}
            onPick={(absolute) => choose({ kind: "file", path: absolute })}
          />
        </div>
        <div className="min-w-0 flex-1">
          {path !== undefined ? (
            <OpenFile root={root} path={path} />
          ) : AsyncResult.isFailure(files) ? (
            <Empty text="Couldn't list this Project's files. Is it a git repository?" />
          ) : (
            <Empty text="Pick a file, or press ⌘P." />
          )}
        </div>
      </div>
    </div>
  );
}
