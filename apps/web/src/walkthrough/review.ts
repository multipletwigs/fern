import type { Hunk, Walkthrough, WalkthroughSince } from "@repo/api";
import type { WalkthroughTone } from "@repo/ui/WalkthroughRow";

// Items in a Walkthrough still waiting on a verdict.
export const openItems = (walkthrough: Walkthrough) =>
  walkthrough.sections.filter((s) => !s.verdict).length +
  walkthrough.unexplained.filter((u) => !u.verdict).length;

// Where a Walkthrough's review stands, as its row in a list shows it.
export const rowStatus = (
  walkthrough: Walkthrough,
): { status: string; tone: WalkthroughTone } => {
  if (walkthrough.status === "writing")
    return { status: "Writing", tone: "writing" };
  if (walkthrough.status === "failed")
    return { status: "Failed", tone: "danger" };
  if (walkthrough.redirectError) return { status: "Not sent", tone: "danger" };
  if (walkthrough.reviewedAt) return { status: "Reviewed", tone: "muted" };
  return { status: `${openItems(walkthrough)} to review`, tone: "amber" };
};

// Where a PR's review stands across its Walkthroughs: the first that isn't Reviewed speaks for it,
// with every open item counted; once all are, Reviewed.
export const prStatus = (
  walkthroughs: ReadonlyArray<Walkthrough>,
): { status: string; tone: WalkthroughTone } => {
  const unsettled = walkthroughs.filter(
    (w) => w.status !== "ready" || w.redirectError || !w.reviewedAt,
  );
  const [first] = unsettled;
  if (!first) return { status: "Reviewed", tone: "muted" };
  if (first.status !== "ready" || first.redirectError) return rowStatus(first);
  const open = unsettled.reduce((sum, w) => sum + openItems(w), 0);
  return { status: `${open} to review`, tone: "amber" };
};

export const sinceLabel: Record<WalkthroughSince, string> = {
  previous: "Since the previous Walkthrough",
  start: "Since the Session started",
  head: "Since the last commit · Fern didn't see this Session start",
  pr: "One PR of the Session's Stack",
};

// A Section's hunks by file, in the order the files first appear.
export const byFile = (hunks: ReadonlyArray<Hunk>) => {
  const files = new Map<string, Array<Hunk>>();
  for (const hunk of hunks)
    files.set(hunk.path, [...(files.get(hunk.path) ?? []), hunk]);
  return [...files];
};
