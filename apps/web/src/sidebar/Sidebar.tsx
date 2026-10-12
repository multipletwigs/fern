import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Hint } from "@repo/ui/Hint";
import { LocationPill } from "@repo/ui/LocationPill";
import { NewSessionButton } from "@repo/ui/NewSessionButton";
import { ProjectGroup } from "@repo/ui/ProjectGroup";
import { SessionRow } from "@repo/ui/SessionRow";
import { SidebarPanel } from "@repo/ui/SidebarPanel";
import { WorktreeBadge } from "@repo/ui/WorktreeBadge";
import { isWorking } from "@repo/api";
import { DateTime } from "effect";
import { Atom, AsyncResult } from "effect/reactivity";
import { useContext, useState } from "react";
import { checkpointsAtom, sessionPhasesAtom } from "../flow/atoms";
import { CheckpointQueue } from "../flow/CheckpointQueue";
import { PHASE_TITLES } from "../flow/phases";
import {
  activeProjectAtom,
  activeSessionIdAtom,
  newSessionAtom,
  preloadedSessionAtom,
  projectsAtom,
  selectedSessionAtom,
} from "../session/atoms";
import { ago, useNow } from "../session/time";
import { screenAtoms } from "../workspace/screen";
import { ArchiveSession } from "./ArchiveSession";
import { RunningSlots } from "./RunningSlots";

const projectName = (path: string) => path.split("/").at(-1) || "Unknown";

export function Sidebar() {
  const projects = useAtomValue(projectsAtom);
  const activeId = useAtomValue(activeSessionIdAtom);
  const activeProject = useAtomValue(activeProjectAtom);
  const setSelected = useAtomSet(selectedSessionAtom);
  const setNew = useAtomSet(newSessionAtom);
  const select = (id: string) => {
    setSelected(id);
    setNew(undefined);
  };
  // Archived Sessions, hidden before the next listing leaves them out.
  const [archived, setArchived] = useState<ReadonlySet<string>>(new Set());
  const onArchived = (id: string) => {
    setArchived((hidden) => new Set(hidden).add(id));
    if (id === activeId) setSelected(undefined);
  };
  const now = useNow();
  const phases = useAtomValue(sessionPhasesAtom);
  const checkpoints = useAtomValue(checkpointsAtom);
  // Each Hosted Session's current Phase's name, "Done" once its Flow is over.
  const phaseOf = new Map(
    AsyncResult.isSuccess(phases)
      ? phases.value.map((p) => [
          p.sessionId,
          p.current ? PHASE_TITLES[p.current] : "Done",
        ])
      : [],
  );
  const waiting = new Set(
    AsyncResult.isSuccess(checkpoints)
      ? checkpoints.value.map((c) => c.sessionId)
      : [],
  );
  // Subscribing for a moment starts a Session's streams; they stay open a while after.
  const registry = useContext(RegistryContext);
  const setPreloaded = useAtomSet(preloadedSessionAtom);
  const preload = (id: string, root: string) => {
    setPreloaded(id);
    screenAtoms(id, root).forEach((atom: Atom.Atom<unknown>) =>
      registry.mount(atom)(),
    );
  };

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
          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <LocationPill
                primary={projectName(activeProject.path)}
                secondary={activeSession?.gitBranch}
              />
            </div>
            <NewSessionButton
              name={projectName(activeProject.path)}
              onClick={() => setNew(activeProject.path)}
              className="size-9 rounded-lg bg-white/[0.05]"
            />
          </div>
        )
      }
    >
      <CheckpointQueue onSelect={select} />
      {projects.value.length === 0 && <Hint text="No sessions yet." />}
      {projects.value.map((project) => (
        <ProjectGroup
          key={project.path}
          name={projectName(project.path)}
          path={project.path}
          onNew={() => setNew(project.path)}
          rows={project.sessions
            .filter((session) => !archived.has(session.id))
            .map((session) => {
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
                  phase={phaseOf.get(session.id)}
                  waiting={waiting.has(session.id)}
                  onSelect={() => select(session.id)}
                  onPreload={() =>
                    preload(session.id, session.worktree ?? project.path)
                  }
                  badge={
                    session.worktree !== undefined && (
                      <WorktreeBadge
                        branch={session.gitBranch}
                        path={session.worktree}
                      />
                    )
                  }
                  action={
                    session.ownWorktree === true && (
                      <ArchiveSession
                        sessionId={session.id}
                        title={session.title}
                        onArchived={() => onArchived(session.id)}
                      />
                    )
                  }
                />
              );
            })}
        />
      ))}
      <RunningSlots onSelect={select} />
    </SidebarPanel>
  );
}
