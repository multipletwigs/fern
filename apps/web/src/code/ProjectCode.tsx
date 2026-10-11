import { useAtom, useAtomValue } from "@effect/atom-react";
import { Empty } from "@repo/ui/Empty";
import { FilePicker } from "@repo/ui/FilePicker";
import { PanelBar } from "@repo/ui/PanelBar";
import { AsyncResult } from "effect/reactivity";
import { openFileAtom, projectFilesAtom } from "./atoms";
import { OpenFile } from "./OpenFile";
import { type ChangedFile, type ReadFile, relativeTo } from "./paths";
import { SessionFiles } from "./SessionFiles";

// The code panel for one Session: the files Claude touched beside the open one, which is the file
// the developer picked, or else the one Claude last changed.
export function ProjectCode({
  sessionId,
  root,
  changed,
  read,
  followed,
}: {
  sessionId: string;
  root: string;
  changed: ReadonlyArray<ChangedFile>;
  read: ReadonlyArray<ReadFile>;
  // The file Claude last changed, as an absolute path.
  followed: string | undefined;
}) {
  const files = useAtomValue(projectFilesAtom(root));
  const [picked, pick] = useAtom(openFileAtom(sessionId));
  const open = picked ?? followed;
  const path = open === undefined ? undefined : relativeTo(root, open);
  // Picking the file Claude last changed goes back to following Claude.
  const choose = (absolute: string) =>
    pick(absolute === followed ? undefined : absolute);

  return (
    <div className="flex h-full flex-col">
      <PanelBar
        start={
          <FilePicker
            files={AsyncResult.isSuccess(files) ? files.value : []}
            current={path}
            onPick={(relative) => choose(`${root}/${relative}`)}
          />
        }
      />
      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 border-r border-hairline">
          <SessionFiles
            changed={changed}
            read={read}
            current={open}
            onPick={choose}
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
