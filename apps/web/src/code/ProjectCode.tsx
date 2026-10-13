import { useAtom, useAtomValue } from "@effect/atom-react";
import type { Walkthrough } from "@repo/api";
import { Empty } from "@repo/ui/Empty";
import { FilePicker } from "@repo/ui/FilePicker";
import { PanelBar } from "@repo/ui/PanelBar";
import { AsyncResult } from "effect/reactivity";
import { waitingWalkthrough } from "../walkthrough/review";
import { WalkthroughList } from "../walkthrough/WalkthroughList";
import { WalkthroughView } from "../walkthrough/WalkthroughView";
import { projectFilesAtom } from "./atoms";
import { type OpenItem, openAtom } from "./panel";
import { OpenFile } from "./OpenFile";
import type { SessionCommit } from "./commits";
import { type ChangedFile, type ReadFile, relativeTo } from "./paths";
import { SessionFiles } from "./SessionFiles";

const keyOf = (item: OpenItem | undefined) =>
  item === undefined
    ? undefined
    : item.kind === "file"
      ? `file:${item.path}`
      : `walkthrough:${item.id}`;

// The code panel for one Session: its Walkthroughs and the files Claude touched beside what's open.
// That's what the developer picked, or else it follows Claude: a Walkthrough waiting on the
// developer, the file Claude is changing while it works, and once it stops, the latest Walkthrough.
export function ProjectCode({
  sessionId,
  root,
  changed,
  commits,
  read,
  followed,
  walkthroughs,
  working,
}: {
  sessionId: string;
  root: string;
  changed: ReadonlyArray<ChangedFile>;
  commits: ReadonlyArray<SessionCommit>;
  read: ReadonlyArray<ReadFile>;
  // The file Claude last changed, as an absolute path.
  followed: string | undefined;
  walkthroughs: ReadonlyArray<Walkthrough>;
  // Claude is running a turn on the Session.
  working: boolean;
}) {
  const files = useAtomValue(projectFilesAtom(root));
  const [picked, pick] = useAtom(openAtom(sessionId));
  const shown =
    waitingWalkthrough(walkthroughs) ??
    (working ? undefined : walkthroughs.at(-1));
  const following: OpenItem | undefined = shown
    ? { kind: "walkthrough", id: shown.id }
    : followed !== undefined
      ? { kind: "file", path: followed }
      : undefined;
  const open = picked ?? following;
  // Picking what Claude would show anyway goes back to following Claude.
  const choose = (item: OpenItem) =>
    pick(keyOf(item) === keyOf(following) ? undefined : item);

  const path = open?.kind === "file" ? relativeTo(root, open.path) : undefined;
  const walkthrough =
    open?.kind === "walkthrough"
      ? walkthroughs.find((w) => w.id === open.id)
      : undefined;

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
            header={
              <WalkthroughList
                sessionId={sessionId}
                walkthroughs={walkthroughs}
                current={walkthrough?.id}
                onPick={(id) => choose({ kind: "walkthrough", id })}
              />
            }
            changed={changed}
            commits={commits}
            read={read}
            current={open?.kind === "file" ? open.path : undefined}
            onPick={(absolute) => choose({ kind: "file", path: absolute })}
          />
        </div>
        <div className="min-w-0 flex-1">
          {walkthrough ? (
            <WalkthroughView walkthrough={walkthrough} />
          ) : path !== undefined ? (
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
