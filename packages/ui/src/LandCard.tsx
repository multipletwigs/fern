import { GitMergeIcon } from "@phosphor-icons/react";
import { Callout } from "./Callout";
import { GhostButton } from "./GhostButton";
import { GhostLink } from "./GhostLink";
import { IssueLink } from "./IssueLink";
import { LandWaits } from "./LandWaits";
import { Loader } from "./Loader";

interface Pr {
  readonly number: number;
  readonly title: string;
  readonly url: string;
}

// A Session's Stack ready to Land on `main`: its PRs, bottom first, and landing them all at once.
// When GitHub refuses, its reason shows in plain words, with a way to send it to the agent, to
// open the Stack on GitHub, and to try again. Nothing lands while the Stack waits on something.
export function LandCard({
  heading,
  summary,
  prs,
  url,
  waiting,
  refusal,
  refusalSent,
  landing,
  action,
  canLand,
  canSend,
  pending,
  failed,
  onLand,
  onSend,
}: {
  heading: string;
  summary: string;
  prs: ReadonlyArray<Pr>;
  url: string;
  waiting: ReadonlyArray<{ readonly pr?: Pr; readonly why: string }>;
  refusal?: string;
  refusalSent: boolean;
  landing: boolean;
  // What landing is called: "Land", or "Try again" once GitHub refused.
  action: string;
  canLand: boolean;
  canSend: boolean;
  pending: boolean;
  failed: boolean;
  onLand: () => void;
  onSend: () => void;
}) {
  return (
    <section
      aria-label="Land"
      className="mb-3 rounded-2xl border border-ice/20 bg-ice/[0.03] p-4"
    >
      <p className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-ice/80 uppercase">
        <GitMergeIcon weight="bold" className="size-3" />
        Land
      </p>
      <h3 className="mt-1.5 text-[15px] leading-6 text-ink">{heading}</h3>
      <p className="mt-2 text-[13px] leading-5 text-muted">{summary}</p>
      <section
        aria-label="Stack"
        className="mt-3 rounded-xl border border-hairline bg-white/[0.02] p-1.5"
      >
        <p className="px-2.5 pt-1 font-mono text-[10px] tracking-wide text-faint uppercase">
          Stack · {prs.length} {prs.length === 1 ? "PR" : "PRs"}, bottom first
        </p>
        <ul className="space-y-px">
          {prs.map((pr) => (
            <li key={pr.number}>
              <IssueLink {...pr} />
            </li>
          ))}
        </ul>
      </section>
      {waiting.length > 0 && <LandWaits waiting={waiting} />}
      {refusal !== undefined && (
        <div className="mt-3">
          <Callout tone="danger">
            <p className="font-mono text-[10px] tracking-wide text-danger/70 uppercase">
              GitHub said
            </p>
            <p className="mt-1 text-ink/85">{refusal}</p>
            {refusalSent && (
              <p className="mt-1.5 text-muted">
                Sent to the agent. Try again once it has pushed its fix.
              </p>
            )}
          </Callout>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {landing ? (
          <span className="flex h-8 items-center gap-2 text-[13px] text-muted">
            <Loader className="text-base" label="Landing" />
            Marking the PRs ready and merging the Stack…
          </span>
        ) : (
          <>
            {refusal !== undefined && (
              <GhostButton disabled={!canSend || pending} onClick={onSend}>
                Send to the agent
              </GhostButton>
            )}
            <GhostLink href={url}>Open on GitHub</GhostLink>
            <GhostButton
              tone="ice"
              disabled={!canLand || pending}
              onClick={onLand}
            >
              {action}
            </GhostButton>
          </>
        )}
      </div>
      {failed && (
        <p className="mt-2 text-xs text-danger/80">
          Couldn't send that. Try again.
        </p>
      )}
    </section>
  );
}
