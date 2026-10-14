import type { ReactNode } from "react";

// A Foreign PR with no Walkthrough yet: what walking through it does, and the action that does it.
export function ForeignPrEmpty({
  loading,
  action,
}: {
  // Its Walkthroughs aren't known yet.
  loading: boolean;
  action: ReactNode;
}) {
  return (
    <div className="mx-auto flex h-full max-w-[560px] flex-col justify-center px-10 py-10">
      <p className="font-mono text-[11px] tracking-wide text-faint uppercase">
        Review
      </p>
      <h2 className="mt-2 text-[24px] leading-8 font-medium text-ink">
        {loading ? "Looking for Walkthroughs…" : "No Walkthrough yet"}
      </h2>
      <p className="mt-2 text-[15px] leading-6 text-ink/60">
        A fresh Claude reads this PR at its head, in a worktree of its own, and
        explains every change in Sections to review one at a time. It only
        reads: your checkout is never touched, and your verdicts stay in Fern.
      </p>
      {!loading && <div className="mt-6">{action}</div>}
    </div>
  );
}
