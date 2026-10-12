import type { Decision } from "@repo/api";
import { DecisionRow } from "@repo/ui/DecisionRow";
import { Empty } from "@repo/ui/Empty";

// Every Decision the Session has settled, oldest first, while no Round is open.
export function SessionDecisions({
  decisions,
}: {
  decisions: ReadonlyArray<Decision>;
}) {
  if (decisions.length === 0)
    return (
      <Empty text="No Decisions yet. Claude's Grill questions show here." />
    );
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[680px] px-8 py-8">
        <p className="font-mono text-[11px] tracking-wide text-faint uppercase">
          Grill
        </p>
        <h2 className="mt-1.5 text-2xl text-ink">Decisions</h2>
        <p className="mt-1 text-sm text-muted">
          {decisions.length} settled in this Session. Claude asks the next Round
          here when it has one.
        </p>
        <div className="mt-6 rounded-2xl border border-hairline p-2">
          {decisions.map((decision, index) => (
            <DecisionRow
              key={decision.id}
              number={index + 1}
              question={decision.question}
              answer={
                [decision.choice, decision.freeText]
                  .filter(Boolean)
                  .join(". ") || "—"
              }
              ownWords={decision.choice === undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
