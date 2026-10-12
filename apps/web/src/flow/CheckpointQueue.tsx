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
    <section aria-label="Checkpoints" className="mb-2">
      <p className="flex h-8 items-center gap-2 px-2.5 font-mono text-[11px] tracking-wide text-faint uppercase">
        <span className="size-1.5 rounded-full bg-amber" />
        Waiting on you · {checkpoints.value.length}
      </p>
      <ul className="space-y-px">
        {checkpoints.value.map((checkpoint) => (
          <li key={checkpoint.id}>
            <button
              type="button"
              onClick={() => onSelect(checkpoint.sessionId)}
              className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-ink/75 transition-colors hover:bg-white/[0.04] hover:text-ink"
            >
              <span className="min-w-0 flex-1 truncate">
                {titles.get(checkpoint.sessionId) ?? "Session"}
              </span>
              <span className="shrink-0 font-mono text-[10px] tracking-wide text-amber/80 uppercase">
                End of {PHASE_TITLES[checkpoint.phase]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
