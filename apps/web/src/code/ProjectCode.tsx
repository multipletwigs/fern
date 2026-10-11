import { useAtom, useAtomValue } from "@effect/atom-react";
import { Empty } from "@repo/ui/Empty";
import { FilePicker } from "@repo/ui/FilePicker";
import { FollowToggle } from "@repo/ui/FollowToggle";
import { PanelBar } from "@repo/ui/PanelBar";
import { DateTime } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useMemo } from "react";
import { transcriptAtom } from "../session/atoms";
import { isLive, useNow } from "../session/time";
import { openFileAtom, projectFilesAtom } from "./atoms";
import { OpenFile } from "./OpenFile";
import { followedFile, relativeTo } from "./paths";

// The code panel for one Session: the file the developer opened, or else the one Claude last touched.
export function ProjectCode({
  sessionId,
  root,
}: {
  sessionId: string;
  root: string;
}) {
  const files = useAtomValue(projectFilesAtom(root));
  const [picked, pick] = useAtom(openFileAtom(sessionId));
  const transcript = useAtomValue(transcriptAtom(sessionId));
  const now = useNow();

  const value = AsyncResult.isSuccess(transcript)
    ? transcript.value
    : undefined;
  const followed = useMemo(
    () => (value ? followedFile(value.items, root) : undefined),
    [value, root],
  );
  const open = picked ?? followed;
  const path = open === undefined ? undefined : relativeTo(root, open);
  const header = value?.header;
  const working =
    header !== undefined &&
    (header.hostedTurn?.running === true ||
      isLive(DateTime.toEpochMillis(header.lastActivityAt), now));

  return (
    <div className="flex h-full flex-col">
      <PanelBar
        start={
          <FilePicker
            files={AsyncResult.isSuccess(files) ? files.value : []}
            current={path}
            onPick={(relative) => pick(`${root}/${relative}`)}
          />
        }
        end={
          <FollowToggle
            following={picked === undefined}
            working={working}
            // Following pins the file on screen; pinned goes back to following.
            onToggle={() => pick(picked === undefined ? open : undefined)}
          />
        }
      />
      <div className="min-h-0 flex-1">
        {path !== undefined ? (
          <OpenFile root={root} path={path} />
        ) : AsyncResult.isFailure(files) ? (
          <Empty text="Couldn't list this Project's files. Is it a git repository?" />
        ) : (
          <Empty text="Claude hasn't opened a file yet. Pick one with ⌘P." />
        )}
      </div>
    </div>
  );
}
