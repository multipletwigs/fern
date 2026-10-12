import type { Checkpoint, Finding } from "@repo/api";
import { FindingCard } from "./FindingCard";

// The Retro Checkpoint when the agent reported Findings: one card each to accept or decline.
// Retro is done once every Finding has a verdict; the accepted ones then go back to the Session.
export function RetroFindings({
  checkpoint,
  findings,
}: {
  checkpoint: Checkpoint;
  findings: ReadonlyArray<Finding>;
}) {
  const decided = findings.filter((f) => f.verdict !== undefined).length;
  return (
    <section
      aria-label="Retro Findings"
      className="mb-3 max-h-[60vh] overflow-y-auto rounded-2xl border border-ice/20 bg-ice/[0.03] p-4"
    >
      <p className="font-mono text-[11px] tracking-wide text-ice/80 uppercase">
        End of Retro · {decided} of {findings.length} decided
      </p>
      <h3 className="mt-1.5 text-[15px] leading-6 text-ink">
        Which Findings should change the Setup?
      </h3>
      <p className="mt-2 text-[13px] leading-5 whitespace-pre-wrap text-muted">
        {checkpoint.summary}
      </p>
      <div className="mt-4 space-y-3">
        {findings.map((finding, index) => (
          <FindingCard key={finding.id} finding={finding} index={index} />
        ))}
      </div>
    </section>
  );
}
