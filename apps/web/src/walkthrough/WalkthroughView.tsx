import type { Walkthrough } from "@repo/api";
import { Callout } from "@repo/ui/Callout";
import { Loader } from "@repo/ui/Loader";
import { ReviewOutcome } from "./ReviewOutcome";
import { openItems, sinceLabel, totalItems } from "./review";
import { UnexplainedItem } from "./UnexplainedItem";
import { WalkthroughSection } from "./WalkthroughSection";
import { WriteWalkthroughButton } from "./WriteWalkthroughButton";

// A Walkthrough as the developer reviews it: its Sections in order, then every Unexplained change.
export function WalkthroughView({ walkthrough }: { walkthrough: Walkthrough }) {
  const locked = walkthrough.reviewedAt !== undefined;
  const total = totalItems(walkthrough);
  const others = walkthrough.overlapping.length;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[760px] space-y-4 px-8 py-8">
        <header className="mb-6">
          <p className="font-mono text-[11px] tracking-wide text-faint uppercase">
            {sinceLabel[walkthrough.since]}
          </p>
          <h2 className="mt-1.5 text-2xl text-ink">
            Walkthrough {walkthrough.number}
          </h2>
          {walkthrough.status === "ready" && (
            <p className="mt-1 text-sm text-muted">
              {total - openItems(walkthrough)} of {total} reviewed
            </p>
          )}
        </header>

        {others > 0 && (
          <Callout tone="amber">
            Fern ran{" "}
            {others === 1 ? "another Session" : `${others} other Sessions`} in
            this repository while this changed, so some of these changes may be
            theirs.
          </Callout>
        )}
        {walkthrough.status === "writing" && (
          <Callout tone="muted">
            <span className="flex items-center gap-2">
              <Loader className="text-base text-muted" label="Writing" />
              Claude is writing this Walkthrough from a fork of the Session.
            </span>
          </Callout>
        )}
        {walkthrough.status === "failed" && (
          <Callout
            tone="danger"
            action={
              <WriteWalkthroughButton
                sessionId={walkthrough.sessionId}
                label="Try again"
              />
            }
          >
            Couldn't write this Walkthrough. {walkthrough.error}
          </Callout>
        )}

        {walkthrough.sections.map((section, index) => (
          <WalkthroughSection
            key={section.id}
            walkthroughId={walkthrough.id}
            section={section}
            index={index}
            locked={locked}
          />
        ))}

        {walkthrough.unexplained.length > 0 && (
          <div className="pt-6 pb-1">
            <h3 className="text-lg text-ink">Unexplained changes</h3>
            <p className="mt-1 text-sm text-muted">
              No Section claims these, so each one needs your verdict.
            </p>
          </div>
        )}
        {walkthrough.unexplained.map((change) => (
          <UnexplainedItem
            key={change.hunk.id}
            walkthroughId={walkthrough.id}
            change={change}
            locked={locked}
          />
        ))}

        {locked && <ReviewOutcome walkthrough={walkthrough} />}
      </div>
    </div>
  );
}
