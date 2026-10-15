import type { ReactNode } from "react";

// The PRs in no Stack on the Pull requests page, after the Stacks, newest first.
export function LonePullRequests({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Not in a Stack"
      className="rounded-xl border border-hairline bg-white/[0.02] p-1.5"
    >
      <header className="flex h-7 items-center px-2.5 font-mono text-[11px] tracking-wide text-faint uppercase">
        Not in a Stack
      </header>
      <ul>{children}</ul>
    </section>
  );
}
