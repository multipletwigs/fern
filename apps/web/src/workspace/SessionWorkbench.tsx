import { useAtomValue } from "@effect/atom-react";
import { Workbench } from "@repo/ui/Workbench";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useMemo, useState } from "react";
import { sessionCommits } from "../code/commits";
import { changedFiles, followedFile, readFiles } from "../code/paths";
import { ProjectCode } from "../code/ProjectCode";
import { preloadedSessionAtom } from "../session/atoms";
import { Session } from "../session/Session";
import { screenAtoms } from "./screen";

// One Session's chat, joined by its code once the Session has changed a file in the Project or has
// a Walkthrough. When another Session is picked, the one on screen stays until the new one has
// loaded and its list shows out of sight, then the new one replaces it in a single frame. The
// Session pointed at in the sidebar, and the one shown before, are drawn ahead, so picking them
// shows them at once.
export function SessionWorkbench({
  sessionId: pickedId,
  root: pickedRoot,
}: {
  sessionId: string;
  root: string | undefined;
}) {
  const [nextTranscript, nextChanges, nextWalkthroughs] = screenAtoms(
    pickedId,
    pickedRoot,
  );
  const nextTranscriptResult = useAtomValue(nextTranscript);
  const nextChangesResult = useAtomValue(nextChanges);
  const nextWalkthroughsResult = useAtomValue(nextWalkthroughs);
  // Without a Project there are no changes to wait for.
  const ready =
    !AsyncResult.isInitial(nextTranscriptResult) &&
    (!pickedRoot || !AsyncResult.isInitial(nextChangesResult)) &&
    !AsyncResult.isInitial(nextWalkthroughsResult);
  const [shown, setShown] = useState({ sessionId: pickedId, root: pickedRoot });
  // The Session shown before this one, kept drawn so switching back shows it at once.
  const [previous, setPrevious] = useState<string>();
  const preloaded = useAtomValue(preloadedSessionAtom);
  // Every Session drawn, in the order first drawn: moving one would reset its scroll. Those not on
  // screen sit out of sight behind it.
  const [drawn, setDrawn] = useState<ReadonlyArray<string>>([pickedId]);
  const wanted = [shown.sessionId, pickedId, preloaded, previous].filter(
    (id) => id !== undefined,
  );
  const nextDrawn = [
    ...drawn.filter((id) => wanted.includes(id)),
    ...wanted.filter(
      (id, i) => !drawn.includes(id) && wanted.indexOf(id) === i,
    ),
  ];
  // The drawn Sessions whose lists show.
  const [painted, setPainted] = useState<ReadonlySet<string>>(new Set());
  const markPainted = useCallback(
    (id: string) =>
      setPainted((ids) => (ids.has(id) ? ids : new Set(ids).add(id))),
    [],
  );
  if (nextDrawn.join() !== drawn.join()) {
    setDrawn(nextDrawn);
    setPainted(new Set([...painted].filter((id) => nextDrawn.includes(id))));
  }
  if (
    ready &&
    (painted.has(pickedId) || shown.sessionId === pickedId) &&
    (shown.sessionId !== pickedId || shown.root !== pickedRoot)
  ) {
    if (shown.sessionId !== pickedId) setPrevious(shown.sessionId);
    setShown({ sessionId: pickedId, root: pickedRoot });
  }
  const { sessionId, root } = shown;

  const [transcriptAtom, changesAtom, walkthroughsAtom] = screenAtoms(
    sessionId,
    root,
  );
  const result = useAtomValue(transcriptAtom);
  const changesResult = useAtomValue(changesAtom);
  const walkthroughsResult = useAtomValue(walkthroughsAtom);
  const items = AsyncResult.isSuccess(result) ? result.value.items : undefined;
  const changes = AsyncResult.isSuccess(changesResult)
    ? changesResult.value
    : undefined;
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

  // Until a Session's transcript, changes and Walkthroughs have all loaded, keep the last layout
  // rather than flashing the chat to full width and back. Then snap to the Session's own layout,
  // and animate only when code arrives in the Session already on screen.
  const [layout, setLayout] = useState<{
    readonly sessionId: string | undefined;
    readonly split: boolean;
    readonly animate: boolean;
  }>({ sessionId: undefined, split: false, animate: false });
  const hasCode =
    changed === undefined ||
    AsyncResult.isInitial(changesResult) ||
    AsyncResult.isInitial(walkthroughsResult)
      ? undefined
      : changed.length > 0 || walkthroughs.length > 0;
  if (
    hasCode !== undefined &&
    (hasCode !== layout.split || sessionId !== layout.sessionId)
  )
    setLayout({
      sessionId,
      split: hasCode,
      animate: sessionId === layout.sessionId,
    });
  const split = layout.split;

  return (
    <Workbench
      animate={layout.animate}
      // Each Session's list keyed by its id, so the one drawn out of sight is the one shown.
      chat={
        <div className="relative h-full">
          {drawn.map((id) => (
            <div
              key={id}
              className={
                id === sessionId ? "h-full" : "invisible absolute inset-0"
              }
            >
              <Session
                id={id}
                visible={id === sessionId}
                onPainted={markPainted}
              />
            </div>
          ))}
        </div>
      }
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
