import type { Section, Walkthrough } from "@repo/api";
import { Markdown } from "@repo/ui/Markdown";
import { ReviewPane } from "@repo/ui/ReviewPane";
import { RiskBadge } from "@repo/ui/RiskBadge";
import type { ReactNode } from "react";
import { SectionFiles } from "../walkthrough/SectionFiles";
import { OverlapNotice } from "./OverlapNotice";
import { SectionCitations } from "./SectionCitations";

// One Section open in the Review tab: its Risk beside the title, the Decisions it cites, the change
// explained, then the files it claims hunks in.
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
      badge={
        section.risk && (
          <RiskBadge level={section.risk.level} reason={section.risk.reason} />
        )
      }
      footer={footer}
    >
      <OverlapNotice walkthrough={walkthrough} />
      <SectionCitations section={section} sessionId={walkthrough.sessionId} />
      {section.fixes && (
        <p className="text-[13px] text-ice/80">
          Fixes your rejection of “{section.fixes.title}” in Walkthrough{" "}
          {section.fixes.walkthrough}
        </p>
      )}
      {/* A Foreign PR's is written from its author's words, so it loads no images. */}
      <Markdown images={walkthrough.foreignPr === undefined}>
        {section.explanation}
      </Markdown>
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
