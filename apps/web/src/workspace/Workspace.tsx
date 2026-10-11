import { useAtomValue } from "@effect/atom-react";
import { Empty } from "@repo/ui/Empty";
import { Workbench } from "@repo/ui/Workbench";
import { AsyncResult } from "effect/reactivity";
import {
  activeProjectAtom,
  activeSessionIdAtom,
  currentSessionAtom,
} from "../session/atoms";
import { SessionWorkbench } from "./SessionWorkbench";

// Everything right of the sidebar: the Session on screen, or why there isn't one.
export function Workspace() {
  const sessionId = useAtomValue(activeSessionIdAtom);
  const project = useAtomValue(activeProjectAtom);
  const current = useAtomValue(currentSessionAtom);
  if (sessionId !== undefined)
    return <SessionWorkbench sessionId={sessionId} root={project?.path} />;
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
