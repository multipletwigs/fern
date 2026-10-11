import type { Draft } from "./WalkthroughWriter";

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
}

// The draft with what the Fork made up taken out: unknown hunk ids, a hunk claimed twice (the first
// Section keeps it), and Sections left claiming nothing.
export const settle = (draft: Draft, ids: ReadonlyArray<string>) => {
  const known = new Set(ids);
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
    });
  }
  const notFromSession = new Set(
    draft.notFromSession.filter((id) => known.has(id)),
  );
  return { sections, notFromSession };
};
