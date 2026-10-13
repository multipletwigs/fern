import type { Risk } from "@repo/api";
import type { Draft, DraftDecision } from "./WalkthroughWriter";

// Hunks the draft neither claims in a Section nor marks as not from this Session.
export const unclaimedHunks = (draft: Draft, ids: ReadonlyArray<string>) => {
  const accounted = new Set([
    ...draft.sections.flatMap((section) => section.hunks),
    ...draft.notFromSession,
  ]);
  return ids.filter((id) => !accounted.has(id));
};

export interface SettledSection {
  readonly title: string;
  readonly explanation: string;
  readonly dropped: string | undefined;
  readonly hunks: ReadonlyArray<string>;
  readonly fixes: string | undefined;
  // The Decisions' own ids, in the order the Fork cited them.
  readonly decisions: ReadonlyArray<string>;
  readonly risk: Risk;
}

// The draft with what the Fork made up taken out: unknown hunk ids, a hunk claimed twice (the first
// Section keeps it), Sections left claiming nothing, and citations of Decisions it wasn't offered.
export const settle = (
  draft: Draft,
  ids: ReadonlyArray<string>,
  decisions: ReadonlyArray<DraftDecision> = [],
) => {
  const known = new Set(ids);
  const decisionIds = new Map(decisions.map((d) => [d.id, d.decisionId]));
  const claimed = new Set<string>();
  const sections: Array<SettledSection> = [];
  for (const section of draft.sections) {
    const hunks = section.hunks.filter((id) => {
      if (!known.has(id) || claimed.has(id)) return false;
      claimed.add(id);
      return true;
    });
    if (hunks.length === 0) continue;
    sections.push({
      title: section.title.trim() || "Untitled change",
      explanation: section.explanation.trim(),
      dropped: section.dropped?.trim() || undefined,
      hunks,
      fixes: section.fixes,
      decisions: [
        ...new Set(
          section.decisions.flatMap((id) => decisionIds.get(id) ?? []),
        ),
      ],
      risk: { level: section.risk.level, reason: section.risk.reason.trim() },
    });
  }
  const notFromSession = new Set(
    draft.notFromSession.filter((id) => known.has(id)),
  );
  return { sections, notFromSession };
};
