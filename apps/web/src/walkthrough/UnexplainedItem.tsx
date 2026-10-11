import type { UnexplainedChange } from "@repo/api";
import { FileHunks } from "@repo/ui/FileHunks";
import { HunkView } from "@repo/ui/HunkView";
import { ReviewCard } from "@repo/ui/ReviewCard";
import { ItemVerdict } from "./ItemVerdict";

// A changed hunk no Section claims, which the developer has to look at all the same.
export function UnexplainedItem({
  walkthroughId,
  change,
  locked,
}: {
  walkthroughId: string;
  change: UnexplainedChange;
  locked: boolean;
}) {
  const { hunk } = change;
  return (
    <ReviewCard
      eyebrow="Unexplained change"
      settled={change.verdict !== undefined}
      footer={
        <ItemVerdict
          walkthroughId={walkthroughId}
          item={hunk.id}
          verdict={change.verdict}
          locked={locked}
        />
      }
    >
      <FileHunks
        path={hunk.path}
        label={hunk.notFromSession ? "Not from this Session" : undefined}
      >
        <HunkView
          header={hunk.header}
          lines={hunk.lines}
          omitted={hunk.omitted}
        />
      </FileHunks>
    </ReviewCard>
  );
}
