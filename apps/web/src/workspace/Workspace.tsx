import { useAtomValue } from "@effect/atom-react";
import { Empty } from "@repo/ui/Empty";
import { Workbench } from "@repo/ui/Workbench";
import { AsyncResult } from "effect/reactivity";
import {
  activeCodeRootAtom,
  activeSessionIdAtom,
  currentSessionAtom,
} from "../session/atoms";
import { NewSession } from "../session/NewSession";
import { Settings } from "../settings/Settings";
import { SessionWorkbench } from "./SessionWorkbench";
import { showingAtom } from "./showing";

// Everything right of the sidebar: Settings, the Session on screen, a new one being started, or
// why there isn't one.
export function Workspace() {
  const sessionId = useAtomValue(activeSessionIdAtom);
  const root = useAtomValue(activeCodeRootAtom);
  const current = useAtomValue(currentSessionAtom);
  const showing = useAtomValue(showingAtom);
  if (showing._tag === "Settings")
    return <Workbench chat={<Settings />} code={undefined} animate={false} />;
  if (showing._tag === "NewSession")
    return (
      <Workbench
        chat={<NewSession key={showing.root} root={showing.root} />}
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
