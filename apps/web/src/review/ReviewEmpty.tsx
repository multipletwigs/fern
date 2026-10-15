import { Column } from "@repo/ui/Column";
import { WriteWalkthroughButton } from "../walkthrough/WriteWalkthroughButton";

// The Review tab before there's anything in it: what will show up here, and a way to ask for a
// Walkthrough of what's changed so far.
export function ReviewEmpty({ sessionId }: { sessionId: string }) {
  return (
    <Column className="flex h-full flex-col justify-center py-10">
      <p className="font-mono text-[11px] tracking-wide text-faint uppercase">
        Review
      </p>
      <h2 className="mt-2 text-[24px] leading-8 font-medium text-ink">
        Nothing to review yet
      </h2>
      <p className="mt-2 text-[15px] leading-6 text-ink/60">
        As each ticket lands, its PR and its Walkthrough appear here, to read
        one Section at a time. You can also ask for a Walkthrough of what this
        Session has changed so far.
      </p>
      <div className="mt-6">
        <WriteWalkthroughButton sessionId={sessionId} />
      </div>
    </Column>
  );
}
