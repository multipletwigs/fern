import type { Finding } from "@repo/api";
import { ReviewCard } from "@repo/ui/ReviewCard";
import { FindingVerdict } from "./FindingVerdict";

// One Finding from Retro: the change it proposes to the Setup, why, and the developer's verdict.
export function FindingCard({
  finding,
  index,
}: {
  finding: Finding;
  index: number;
}) {
  return (
    <ReviewCard
      eyebrow={`Finding ${index + 1}`}
      title={finding.title}
      settled={finding.verdict !== undefined}
      footer={
        <FindingVerdict findingId={finding.id} verdict={finding.verdict} />
      }
    >
      <p className="text-[13px] leading-5 whitespace-pre-wrap text-ink/90">
        <span className="text-faint">Change: </span>
        {finding.change}
      </p>
      <p className="text-[13px] leading-5 whitespace-pre-wrap text-muted">
        <span className="text-faint">Why: </span>
        {finding.reasoning}
      </p>
    </ReviewCard>
  );
}
