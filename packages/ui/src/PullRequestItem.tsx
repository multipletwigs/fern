import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  RobotIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { PullRequestMark } from "./PullRequestMark";

const ROW =
  "group flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[13px] text-ink/80 transition-colors hover:bg-white/[0.04]";
const GO =
  "size-3 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100";

// One pull request on the Pull requests page, on one line: its number, title and author, marked
// when it's a draft, when the developer is asked to review it, and when one of the developer's
// Hosted Sessions holds it. A Session's PR opens in the Session through `onOpen`; any other opens
// on GitHub at `url`.
export function PullRequestItem({
  number,
  title,
  author,
  url,
  draft,
  reviewRequested,
  session,
  onOpen,
}: {
  number: number;
  title: string;
  author: string;
  url: string;
  draft: boolean;
  reviewRequested: boolean;
  // What to call the Hosted Session holding it, when one does.
  session?: string | undefined;
  onOpen?: (() => void) | undefined;
}) {
  const content: ReactNode = (
    <>
      <span className="w-12 shrink-0 font-mono text-[11px] text-faint tabular-nums">
        #{number}
      </span>
      <span className="min-w-0 flex-1 truncate group-hover:text-ink">
        {title}
      </span>
      {reviewRequested && (
        <PullRequestMark tone="amber">Review requested</PullRequestMark>
      )}
      {draft && <PullRequestMark tone="muted">Draft</PullRequestMark>}
      {session !== undefined && (
        <span
          title={`On your Session's Stack: ${session}`}
          className="flex max-w-40 shrink-0 items-center gap-1 text-[11px] text-ice/80"
        >
          <RobotIcon className="size-3 shrink-0" />
          <span className="truncate">{session}</span>
        </span>
      )}
      <span className="w-28 shrink-0 truncate text-right text-[12px] text-muted">
        {author}
      </span>
      {onOpen ? (
        <ArrowRightIcon weight="bold" className={GO} />
      ) : (
        <ArrowUpRightIcon weight="bold" className={GO} />
      )}
    </>
  );
  return (
    <li>
      {onOpen ? (
        <button type="button" onClick={onOpen} className={ROW}>
          {content}
        </button>
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className={ROW}>
          {content}
        </a>
      )}
    </li>
  );
}
