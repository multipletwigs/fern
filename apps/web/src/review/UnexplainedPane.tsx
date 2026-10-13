import type { UnexplainedChange, Walkthrough } from "@repo/api";
import { FileHunks } from "@repo/ui/FileHunks";
import { HunkView } from "@repo/ui/HunkView";
import { ReviewPane } from "@repo/ui/ReviewPane";
import type { ReactNode } from "react";
import { OverlapNotice } from "./OverlapNotice";

// A changed hunk no Section claims, open in the Review tab: the developer has to look at it all the
// same.
export function UnexplainedPane({
  walkthrough,
  change,
  footer,
}: {
  walkthrough: Walkthrough;
  change: UnexplainedChange;
  footer: ReactNode;
}) {
  const { hunk } = change;
  return (
    <ReviewPane
      eyebrow={`Walkthrough ${walkthrough.number} · Unexplained change`}
      title={hunk.path}
      footer={footer}
    >
      <OverlapNotice walkthrough={walkthrough} />
      <p className="text-muted">
        No Section claims this change, so it needs your verdict.
      </p>
      <FileHunks
        path={hunk.path}
        label={hunk.notFromSession ? "Not from this Session" : undefined}
      >
        <HunkView
          path={hunk.path}
          header={hunk.header}
          lines={hunk.lines}
          omitted={hunk.omitted}
        />
      </FileHunks>
    </ReviewPane>
  );
}
