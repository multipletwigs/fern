import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";

// One issue on the issue tracker, on one line: its number and title, opening it in the browser.
export function IssueLink({
  number,
  title,
  url,
  prominent = false,
}: {
  number: number;
  title: string;
  url: string;
  prominent?: boolean;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={clsx(
        "group flex items-center gap-2.5 rounded-lg px-2.5 transition-colors hover:bg-white/[0.04]",
        prominent ? "h-9 text-[14px] text-ink" : "h-8 text-[13px] text-ink/75",
      )}
    >
      <span className="w-10 shrink-0 font-mono text-[11px] text-faint tabular-nums">
        #{number}
      </span>
      <span className="min-w-0 flex-1 truncate group-hover:text-ink">
        {title}
      </span>
      <ArrowUpRightIcon
        weight="bold"
        className="size-3 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"
      />
    </a>
  );
}
