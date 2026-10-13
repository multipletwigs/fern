import { useAtomValue } from "@effect/atom-react";
import { Empty } from "@repo/ui/Empty";
import { Workbench } from "@repo/ui/Workbench";
import { AsyncResult } from "effect/reactivity";
import {
  activeCodeRootAtom,
  activeSessionIdAtom,
  currentSessionAtom,
  newSessionAtom,
} from "../session/atoms";
import { NewSession } from "../session/NewSession";
import { settingsOpenAtom } from "../settings/atoms";
import { Settings } from "../settings/Settings";
import { SessionWorkbench } from "./SessionWorkbench";

// Everything right of the sidebar: Settings, the Session on screen, a new one being started, or
// why there isn't one.
export function Workspace() {
  const sessionId = useAtomValue(activeSessionIdAtom);
  const root = useAtomValue(activeCodeRootAtom);
  const current = useAtomValue(currentSessionAtom);
  const newRoot = useAtomValue(newSessionAtom);
  const settingsOpen = useAtomValue(settingsOpenAtom);
  if (settingsOpen)
    return <Workbench chat={<Settings />} code={undefined} animate={false} />;
  if (newRoot !== undefined)
    return (
      <Workbench
        chat={<NewSession key={newRoot} root={newRoot} />}
        code={undefined}
      />
    );
  if (sessionId !== undefined)
    return <SessionWorkbench sessionId={sessionId} root={root} />;
  return (
    <Workbench
      chat={
        <Empty
          text={
            AsyncResult.isFailure(current)
              ? "No Claude Code sessions found yet."
              : "Looking for your latest session…"
          }
        />
      }
      code={undefined}
    />
  );
}
