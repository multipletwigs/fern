import type { Section } from "@repo/api";
import { DecisionChip } from "@repo/ui/DecisionChip";
import { UnplannedChip } from "@repo/ui/UnplannedChip";

// Why a Section changed: a chip per Decision it cites, or Unplanned when it cites none. A Section
// written before Sections cited Decisions shows neither.
export function SectionCitations({
  section,
  sessionId,
}: {
  section: Section;
  // The Session the Walkthrough is of, to tell its own Decisions from earlier Sessions'.
  sessionId: string;
}) {
  if (!section.unplanned && section.decisions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-start gap-1.5">
      {section.unplanned && <UnplannedChip />}
      {section.decisions.map((decision) => (
        <DecisionChip
          key={decision.id}
          question={decision.question}
          recommendation={decision.recommendation}
          choice={decision.choice}
          freeText={decision.freeText}
          earlier={decision.sessionId !== sessionId}
        />
      ))}
    </div>
  );
}
