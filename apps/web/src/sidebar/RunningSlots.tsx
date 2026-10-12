import { useAtomValue } from "@effect/atom-react";
import { Hint } from "@repo/ui/Hint";
import { VerifySlotRow } from "@repo/ui/VerifySlotRow";
import { Cause, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { projectsAtom } from "../session/atoms";
import { verifySlotsAtom } from "../verify/atoms";
import { slotSession } from "../verify/slotSession";

// The isolated Ferns agents have running from worktrees (`pnpm verify:up`), near the bottom of the
// sidebar: each one's branch, page and API port, and the Session it belongs to, which picking
// opens. Nothing while none runs.
export function RunningSlots({
  onSelect,
}: {
  onSelect: (sessionId: string) => void;
}) {
  const slots = useAtomValue(verifySlotsAtom);
  const projects = useAtomValue(projectsAtom);

  if (AsyncResult.isFailure(slots)) {
    const error = Option.getOrUndefined(Cause.findErrorOption(slots.cause));
    return (
      <section aria-label="Running" className="mt-6">
        <Hint
          text={`Couldn't read the running worktrees${error ? `: ${error.message}` : "."}`}
        />
      </section>
    );
  }
  if (!AsyncResult.isSuccess(slots) || slots.value.length === 0) return null;

  return (
    <section aria-label="Running" className="mt-6">
      <p className="flex h-8 items-center px-2.5 font-mono text-[11px] tracking-wide text-faint uppercase">
        Running · {slots.value.length}
      </p>
      <ul className="space-y-px">
        {slots.value.map((slot) => {
          const session = AsyncResult.isSuccess(projects)
            ? slotSession(projects.value, slot)
            : undefined;
          return (
            <li key={slot.slot}>
              <VerifySlotRow
                slot={slot.slot}
                branch={slot.branch}
                worktree={slot.worktree}
                pageUrl={slot.pageUrl}
                apiPort={slot.apiPort}
                stopped={slot.processes
                  .filter((p) => !p.alive)
                  .map((p) => p.name)}
                session={
                  session && {
                    title: session.title,
                    onSelect: () => onSelect(session.id),
                  }
                }
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
