import { ArrowUpRightIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

// A GhostButton that opens a web page in the browser instead.
export function GhostLink({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline px-3 text-[13px] text-ink/75 transition-colors hover:bg-white/[0.05] hover:text-ink"
    >
      {children}
      <ArrowUpRightIcon weight="bold" className="size-3 text-faint" />
    </a>
  );
}
