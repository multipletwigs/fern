import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { projectsAtom } from "../session/atoms";
import { checkpointsAtom } from "./atoms";
import { PHASE_TITLES } from "./phases";

// Every Session's pending Checkpoint, oldest first, at the top of the sidebar: picking one opens
// its Session. Nothing while no Session waits.
export function CheckpointQueue({
  onSelect,
}: {
  onSelect: (sessionId: string) => void;
}) {
  const checkpoints = useAtomValue(checkpointsAtom);
  const projects = useAtomValue(projectsAtom);
  if (!AsyncResult.isSuccess(checkpoints) || checkpoints.value.length === 0)
    return null;
  const titles = new Map(
    AsyncResult.isSuccess(projects)
      ? projects.value.flatMap((p) => p.sessions.map((s) => [s.id, s.title]))
      : [],
  );
  return (
    <section aria-label="Checkpoints" className="mb-3">
      <p className="side-heading">
        <span className="size-1.5 rounded-full bg-amber" />
        Waiting on you · {checkpoints.value.length}
      </p>
      <ul className="space-y-0.5">
        {checkpoints.value.map((checkpoint) => (
          <li key={checkpoint.id}>
            <button
              type="button"
              onClick={() => onSelect(checkpoint.sessionId)}
              className="side-row gap-2.5 px-2.5 text-left"
            >
              <span className="min-w-0 flex-1 truncate">
                {titles.get(checkpoint.sessionId) ?? "Session"}
              </span>
              <span className="shrink-0 font-mono text-[10px] tracking-wide text-amber/80 uppercase">
                {checkpoint.kind === "land"
                  ? "Land"
                  : `End of ${PHASE_TITLES[checkpoint.phase]}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
