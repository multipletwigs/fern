import { StackIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

// A GitHub Stack on the Pull requests page: its number, how many of its PRs are listed and who
// wrote them, over its PRs' rows, bottom first.
export function PullRequestStack({
  number,
  count,
  authors,
  children,
}: {
  number: number;
  count: number;
  authors: ReadonlyArray<string>;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={`Stack ${number}`}
      className="rounded-xl border border-hairline bg-white/[0.02] p-1.5"
    >
      <header className="flex h-7 items-center gap-2 px-2.5 text-[11px] text-faint">
        <StackIcon className="size-3.5 shrink-0" />
        <span className="font-mono tracking-wide uppercase">
          Stack #{number}
        </span>
        <span>
          {count} {count === 1 ? "PR" : "PRs"}
        </span>
        <span className="min-w-0 truncate">· {authors.join(", ")}</span>
      </header>
      <ol>{children}</ol>
    </section>
  );
}
