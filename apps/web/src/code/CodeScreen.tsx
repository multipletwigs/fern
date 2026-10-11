import { useAtomValue } from "@effect/atom-react";
import { Empty } from "@repo/ui/Empty";
import { activeProjectAtom, activeSessionIdAtom } from "../session/atoms";
import { ProjectCode } from "./ProjectCode";

export function CodeScreen() {
  const sessionId = useAtomValue(activeSessionIdAtom);
  const project = useAtomValue(activeProjectAtom);
  if (sessionId === undefined || project === undefined)
    return <Empty text="Open a Session to see its code." />;
  return (
    <ProjectCode key={sessionId} sessionId={sessionId} root={project.path} />
  );
}
