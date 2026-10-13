import { GitMergeIcon } from "@phosphor-icons/react";
import { LandWaits } from "./LandWaits";

// Before a Session's Land Checkpoint opens: what its Stack still waits on, so the developer knows
// what stands between their review and `main`.
export function LandWaitingCard({
  waiting,
}: {
  waiting: ReadonlyArray<{
    readonly pr?: { number: number; title: string; url: string };
    readonly why: string;
  }>;
}) {
  return (
    <section
      aria-label="Land waits"
      className="mb-3 rounded-2xl border border-hairline bg-white/[0.02] p-4"
    >
      <p className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-faint uppercase">
        <GitMergeIcon weight="bold" className="size-3" />
        Land
      </p>
      <h3 className="mt-1.5 text-[14px] leading-6 text-ink/85">
        The Stack lands once your review is done
      </h3>
      <LandWaits waiting={waiting} />
    </section>
  );
}
