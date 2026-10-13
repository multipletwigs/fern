import { useAtom, useAtomValue } from "@effect/atom-react";
import { Workbench } from "@repo/ui/Workbench";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";
import { sessionCommits } from "../code/commits";
import { codePanelOpenAtom, isCodePanelToggle } from "../code/panel";
import { changedFiles, followedFile, readFiles } from "../code/paths";
import { ProjectCode } from "../code/ProjectCode";
import { preloadedSessionAtom } from "../session/atoms";
import { Session } from "../session/Session";
import { SessionTerminalPanel } from "../terminal/SessionTerminalPanel";
import { screenAtoms } from "./screen";

// One Session's chat, joined by its code while the developer has the code panel open, by the
// button in the top bar or ⌘\. When another Session is picked, the one on screen stays until the
// new one has loaded and its list shows out of sight, then the new one replaces it in a single
// frame. The Session pointed at in the sidebar, and the one shown before, are drawn ahead, so
// picking them shows them at once. Its terminal, once opened, runs along the bottom under both.
export function SessionWorkbench({
  sessionId: pickedId,
  root: pickedRoot,
}: {
  sessionId: string;
  root: string | undefined;
}) {
  const [nextTranscript, nextChanges, nextWalkthroughs, nextFlow] = screenAtoms(
    pickedId,
    pickedRoot,
  );
  const nextTranscriptResult = useAtomValue(nextTranscript);
  const nextChangesResult = useAtomValue(nextChanges);
  const nextWalkthroughsResult = useAtomValue(nextWalkthroughs);
  const nextFlowResult = useAtomValue(nextFlow);
  // Without a Project there are no changes to wait for.
  const ready =
    !AsyncResult.isInitial(nextTranscriptResult) &&
    (!pickedRoot || !AsyncResult.isInitial(nextChangesResult)) &&
    !AsyncResult.isInitial(nextWalkthroughsResult) &&
    !AsyncResult.isInitial(nextFlowResult);
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

  // The code panel shows while the developer has it open and the Session has a Project. Animate
  // only a toggle in the Session on screen, never a switch to a Session without a Project.
  const [codeOpen, setCodeOpen] = useAtom(codePanelOpenAtom);
  const split = codeOpen && root !== undefined;
  const [layout, setLayout] = useState({ sessionId, split, animate: false });
  if (split !== layout.split || sessionId !== layout.sessionId)
    setLayout({ sessionId, split, animate: sessionId === layout.sessionId });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isCodePanelToggle(event)) return;
      event.preventDefault();
      setCodeOpen((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCodeOpen]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
                  changed={
                    id === sessionId && root
                      ? (changed?.length ?? 0)
                      : undefined
                  }
                  onPainted={markPainted}
                />
              </div>
            ))}
          </div>
        }
        code={
          split ? (
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
      {root && <SessionTerminalPanel sessionId={sessionId} root={root} />}
    </div>
  );
}
