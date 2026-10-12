import { useAtomValue } from "@effect/atom-react";
import { WorktreeBadge } from "@repo/ui/WorktreeBadge";
import { AsyncResult } from "effect/reactivity";
import { projectsAtom } from "./atoms";

// In the Session's top bar, the worktree it runs in and that worktree's branch. Nothing for a
// Session in the Project's own checkout.
export function SessionWorktree({ sessionId }: { sessionId: string }) {
  const projects = useAtomValue(projectsAtom);
  const session = AsyncResult.isSuccess(projects)
    ? projects.value
        .flatMap((project) => project.sessions)
        .find((s) => s.id === sessionId)
    : undefined;
  if (session?.worktree === undefined) return null;
  return (
    <WorktreeBadge
      branch={session.gitBranch}
      path={session.worktree}
      labelled
      className="max-w-[280px] shrink-0"
    />
  );
}
