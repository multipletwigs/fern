import { useAtomValue } from "@effect/atom-react";
import type { SessionChanges } from "@repo/api";
import { Workbench } from "@repo/ui/Workbench";
import { Atom, AsyncResult } from "effect/reactivity";
import { useMemo, useState } from "react";
import { sessionChangesAtom } from "../code/atoms";
import { sessionCommits } from "../code/commits";
import { changedFiles, followedFile, readFiles } from "../code/paths";
import { ProjectCode } from "../code/ProjectCode";
import { transcriptAtom } from "../session/atoms";
import { Session } from "../session/Session";
import { walkthroughsAtom } from "../walkthrough/atoms";

// Stands in for a Session's changes while its Project isn't known yet.
const noChangesAtom: Atom.Atom<
  AsyncResult.AsyncResult<SessionChanges, unknown>
> = Atom.make(AsyncResult.initial());

// One Session's chat, joined by its code once the Session has changed a file in the Project or has
// a Walkthrough.
export function SessionWorkbench({
  sessionId,
  root,
}: {
  sessionId: string;
  root: string | undefined;
}) {
  const result = useAtomValue(transcriptAtom(sessionId));
  const items = AsyncResult.isSuccess(result) ? result.value.items : undefined;
  const changesResult = useAtomValue(
    root ? sessionChangesAtom(root)(sessionId) : noChangesAtom,
  );
  const changes = AsyncResult.isSuccess(changesResult)
    ? changesResult.value
    : undefined;
  const walkthroughsResult = useAtomValue(walkthroughsAtom(sessionId));
  const walkthroughs = useMemo(
    () =>
      AsyncResult.isSuccess(walkthroughsResult) ? walkthroughsResult.value : [],
    [walkthroughsResult],
  );
  const changed = useMemo(
    () => (items && root ? changedFiles(items, root, changes) : undefined),
    [items, root, changes],
  );
  const read = useMemo(
    () =>
      items && root && changed ? readFiles(items, root, changed) : undefined,
    [items, root, changed],
  );
  const commits = useMemo(() => (items ? sessionCommits(items) : []), [items]);
  const followed = useMemo(
    () => (items && root ? followedFile(items, root) : undefined),
    [items, root],
  );

  // While a Session's transcript loads, keep the last layout rather than flashing the chat to full
  // width and back.
  const [split, setSplit] = useState(false);
  const hasCode =
    changed === undefined
      ? undefined
      : changed.length > 0 || walkthroughs.length > 0;
  if (hasCode !== undefined && hasCode !== split) setSplit(hasCode);

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
            commits={commits}
            read={read ?? []}
            followed={followed}
            walkthroughs={walkthroughs}
            working={
              AsyncResult.isSuccess(result) &&
              result.value.header?.hostedTurn?.running === true
            }
          />
        ) : undefined
      }
    />
  );
}
