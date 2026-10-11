import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Hint } from "@repo/ui/Hint";
import { LocationPill } from "@repo/ui/LocationPill";
import { ProjectGroup } from "@repo/ui/ProjectGroup";
import { SessionRow } from "@repo/ui/SessionRow";
import { SidebarPanel } from "@repo/ui/SidebarPanel";
import { isWorking } from "@repo/api";
import { DateTime } from "effect";
import { AsyncResult } from "effect/reactivity";
import {
  activeProjectAtom,
  activeSessionIdAtom,
  newSessionAtom,
  projectsAtom,
  selectedSessionAtom,
} from "../session/atoms";
import { ago, useNow } from "../session/time";

const projectName = (path: string) => path.split("/").at(-1) || "Unknown";

export function Sidebar() {
  const projects = useAtomValue(projectsAtom);
  const activeId = useAtomValue(activeSessionIdAtom);
  const activeProject = useAtomValue(activeProjectAtom);
  const setSelected = useAtomSet(selectedSessionAtom);
  const closeNew = useAtomSet(newSessionAtom);
  const select = (id: string) => {
    setSelected(id);
    closeNew(undefined);
  };
  const now = useNow();

  if (!AsyncResult.isSuccess(projects))
    return (
      <SidebarPanel>
        <Hint
          text={
            AsyncResult.isFailure(projects)
              ? "Couldn't read your sessions."
              : "Loading projects…"
          }
        />
      </SidebarPanel>
    );

  const activeSession = activeProject?.sessions.find(
    (session) => session.id === activeId,
  );

  return (
    <SidebarPanel
      header={
        activeProject && (
          <LocationPill
            primary={projectName(activeProject.path)}
            secondary={activeSession?.gitBranch}
          />
        )
      }
    >
      {projects.value.length === 0 && <Hint text="No sessions yet." />}
      {projects.value.map((project) => (
        <ProjectGroup
          key={project.path}
          name={projectName(project.path)}
          path={project.path}
          rows={project.sessions.map((session) => {
            const lastActivityMs = DateTime.toEpochMillis(
              session.lastActivityAt,
            );
            return (
              <SessionRow
                key={session.id}
                title={session.title}
                active={session.id === activeId}
                live={isWorking(lastActivityMs, session.hostedTurn, now)}
                lastActive={ago(now - lastActivityMs)}
                onSelect={() => select(session.id)}
              />
            );
          })}
        />
      ))}
    </SidebarPanel>
  );
}
