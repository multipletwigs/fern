import type { Section } from "@repo/api";
import { FileHunks } from "@repo/ui/FileHunks";
import { HunkView } from "@repo/ui/HunkView";
import { Markdown } from "@repo/ui/Markdown";
import { ReviewCard } from "@repo/ui/ReviewCard";
import { ItemVerdict } from "./ItemVerdict";
import { byFile } from "./review";

// One Section: the change explained, the hunks it claims, and the developer's verdict.
export function WalkthroughSection({
  walkthroughId,
  section,
  index,
  locked,
}: {
  walkthroughId: string;
  section: Section;
  index: number;
  locked: boolean;
}) {
  return (
    <ReviewCard
      eyebrow={`Section ${index + 1}`}
      title={section.title}
      settled={section.verdict !== undefined}
      footer={
        <ItemVerdict
          walkthroughId={walkthroughId}
          item={section.id}
          verdict={section.verdict}
          locked={locked}
        />
      }
    >
      {section.fixes && (
        <p className="text-[13px] text-ice/80">
          Fixes your rejection of “{section.fixes.title}” in Walkthrough{" "}
          {section.fixes.walkthrough}
        </p>
      )}
      <Markdown>{section.explanation}</Markdown>
      {section.dropped && (
        <p className="text-[13px] leading-5 text-muted">
          <span className="text-faint">Tried and dropped: </span>
          {section.dropped}
        </p>
      )}
      {byFile(section.hunks).map(([path, hunks]) => (
        <FileHunks key={path} path={path}>
          {hunks.map((hunk) => (
            <HunkView
              key={hunk.id}
              header={hunk.header}
              lines={hunk.lines}
              omitted={hunk.omitted}
            />
          ))}
        </FileHunks>
      ))}
    </ReviewCard>
  );
}
