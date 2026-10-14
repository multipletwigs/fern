import { ArrowLeftIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { PanelBar } from "./PanelBar";

// One pull request open on the Pull requests page, in the content card: a way back to the list,
// which PR it is, with a link to it on GitHub, then its review filling the rest.
export function PullRequestReviewPanel({
  number,
  title,
  url,
  onBack,
  children,
}: {
  number: number;
  // Its title, once it's known.
  title: string | undefined;
  url: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <PanelBar
        start={
          <>
            <button
              type="button"
              onClick={onBack}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] text-ink/75 transition-colors hover:bg-white/[0.05] hover:text-ink"
            >
              <ArrowLeftIcon className="size-3.5" />
              Pull requests
            </button>
            <span className="min-w-0 truncate text-[13px] text-ink/75">
              <span className="font-mono text-[11px] text-faint tabular-nums">
                #{number}
              </span>
              {title !== undefined && <span className="ml-2">{title}</span>}
            </span>
          </>
        }
        end={
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted transition-colors hover:bg-white/[0.05] hover:text-ink"
          >
            Open on GitHub
            <ArrowUpRightIcon className="size-3" />
          </a>
        }
      />
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
}
