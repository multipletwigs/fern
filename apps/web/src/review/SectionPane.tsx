import type { Section, Walkthrough } from "@repo/api";
import { Markdown } from "@repo/ui/Markdown";
import { ReviewPane } from "@repo/ui/ReviewPane";
import type { ReactNode } from "react";
import { SectionFiles } from "../walkthrough/SectionFiles";
import { OverlapNotice } from "./OverlapNotice";

// One Section open in the Review tab: the change explained, then the files it claims hunks in.
export function SectionPane({
  walkthrough,
  section,
  index,
  footer,
}: {
  walkthrough: Walkthrough;
  section: Section;
  index: number;
  footer: ReactNode;
}) {
  return (
    <ReviewPane
      eyebrow={`Walkthrough ${walkthrough.number} · Section ${index + 1} of ${walkthrough.sections.length}`}
      title={section.title}
      footer={footer}
    >
      <OverlapNotice walkthrough={walkthrough} />
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
      <SectionFiles hunks={section.hunks} />
    </ReviewPane>
  );
}
