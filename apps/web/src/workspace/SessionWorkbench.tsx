import { useAtomValue } from "@effect/atom-react";
import { Workbench } from "@repo/ui/Workbench";
import { AsyncResult } from "effect/reactivity";
import { useMemo, useState } from "react";
import { changedFiles, followedFile, readFiles } from "../code/paths";
import { ProjectCode } from "../code/ProjectCode";
import { transcriptAtom } from "../session/atoms";
import { Session } from "../session/Session";

// One Session's chat, joined by its code once Claude has changed a file in the Project.
export function SessionWorkbench({
  sessionId,
  root,
}: {
  sessionId: string;
  root: string | undefined;
}) {
  const result = useAtomValue(transcriptAtom(sessionId));
  const items = AsyncResult.isSuccess(result) ? result.value.items : undefined;
  const changed = useMemo(
    () => (items && root ? changedFiles(items, root) : undefined),
    [items, root],
  );
  const read = useMemo(
    () => (items && root ? readFiles(items, root) : undefined),
    [items, root],
  );
  const followed = useMemo(
    () => (items && root ? followedFile(items, root) : undefined),
    [items, root],
  );

  // While a Session's transcript loads, keep the last layout rather than flashing the chat to full
  // width and back.
  const [split, setSplit] = useState(false);
  const hasChanges = changed && changed.length > 0;
  if (hasChanges !== undefined && hasChanges !== split) setSplit(hasChanges);

  return (
    <Workbench
      // Keyed so switching Sessions starts a fresh list, scrolled to the end.
      chat={<Session key={sessionId} id={sessionId} />}
      code={
        split && root ? (
          <ProjectCode
            key={sessionId}
            sessionId={sessionId}
            root={root}
            changed={changed ?? []}
            read={read ?? []}
            followed={followed}
          />
        ) : undefined
      }
    />
  );
}
