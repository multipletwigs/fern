import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import type { DeveloperToolState } from "@repo/api";
import { clsx } from "clsx";

const LABELS: Record<DeveloperToolState, string> = {
  ready: "Ready",
  "needs-attention": "Needs attention",
  missing: "Missing",
  unknown: "Unknown",
};

const TONES: Record<DeveloperToolState, string> = {
  ready: "bg-mint",
  "needs-attention": "bg-amber",
  missing: "bg-danger",
  unknown: "bg-muted",
};

// One of the developer's tools in Settings: its name and command, where it stands, its version and,
// for `gh`, who it's signed in as. Anything not ready says why in a line, and what to do about it:
// a page to install it from, a command to run, or both.
export function ToolStatusRow({
  name,
  command,
  state,
  version,
  account,
  detail,
  fix,
}: {
  // How the developer knows it, e.g. "GitHub CLI".
  name: string;
  // What it's run as, e.g. "gh".
  command: string;
  state: DeveloperToolState;
  version?: string | undefined;
  account?: string | undefined;
  detail?: string | undefined;
  fix?:
    | {
        readonly url?: string | undefined;
        readonly command?: string | undefined;
      }
    | undefined;
}) {
  return (
    <li className="flex gap-4 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex h-6 items-baseline gap-2.5">
          <span className="text-[14px] text-ink">{name}</span>
          <span className="font-mono text-xs text-faint">{command}</span>
        </div>
        {(version || account) && (
          <div className="flex min-h-5 flex-wrap items-center gap-x-3 font-mono text-xs text-muted">
            {version && <span className="tabular-nums">{version}</span>}
            {account && <span>signed in as {account}</span>}
          </div>
        )}
        {state !== "ready" && (detail || fix) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
            {detail && <span className="text-ink/70">{detail}</span>}
            {fix?.command && (
              <code className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-ink select-all">
                {fix.command}
              </code>
            )}
            {fix?.url && (
              <a
                href={fix.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-ice/90 transition-colors hover:text-ice"
              >
                Install {command}
                <ArrowSquareOutIcon className="size-3.5" />
              </a>
            )}
          </div>
        )}
      </div>
      <div className="flex h-6 shrink-0 items-center gap-2 text-[13px] text-ink/80">
        <span
          aria-hidden
          className={clsx("size-1.5 rounded-full", TONES[state])}
        />
        {LABELS[state]}
      </div>
    </li>
  );
}
