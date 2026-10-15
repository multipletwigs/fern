import { ArrowClockwiseIcon, GitPullRequestIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { GhostButton } from "./GhostButton";
import { Loader } from "./Loader";
import { PanelBar } from "./PanelBar";

// A Project's Pull requests page, in the content card: which Project and repo it shows, a Refresh
// button, anything to say about the last fetch, then the list. While `refreshing`, the button says
// so and the list shown is the last one fetched.
export function PullRequestsPanel({
  name,
  path,
  repo,
  refreshing,
  onRefresh,
  notice,
  children,
}: {
  name: string;
  path: string;
  // The repo on GitHub, as "owner/name", once it's known.
  repo: string | undefined;
  refreshing: boolean;
  onRefresh: () => void;
  // Why the last fetch failed, when it did.
  notice?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <PanelBar
        start={
          <div className="flex min-w-0 items-center gap-2 px-2 text-[13px] text-ink/75">
            <GitPullRequestIcon className="size-3.5 shrink-0" />
            <span>Pull requests</span>
          </div>
        }
        end={
          <GhostButton disabled={refreshing} onClick={onRefresh}>
            {refreshing ? (
              <span className="flex items-center gap-2">
                <Loader label="Refreshing" className="text-sm" />
                Refreshing…
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <ArrowClockwiseIcon className="size-3.5" />
                Refresh
              </span>
            )}
          </GhostButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-10">
          <h1 className="text-xl text-ink">{name}</h1>
          <p className="mt-1 flex min-w-0 items-baseline gap-2.5 text-[13px] text-muted">
            {repo !== undefined && (
              <a
                href={`https://github.com/${repo}/pulls`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 hover:text-ink"
              >
                {repo}
              </a>
            )}
            <span
              title={path}
              className="min-w-0 truncate font-mono text-xs text-faint"
            >
              {path}
            </span>
          </p>
          {notice !== undefined && <div className="mt-6">{notice}</div>}
          <div className="mt-6 space-y-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
