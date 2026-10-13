import { clsx } from "clsx";
import type { WalkthroughTone } from "./WalkthroughRow";

// A heading over the entries of a review layout's list that belong together, such as a
// Walkthrough's, with where they stand and, on hover, a `hint`. A `minor` one splits a group, as before a Walkthrough's
// Unexplained changes. In a narrow layout it folds to a rule between the marks.
export function ReviewHeading({
  title,
  status,
  tone = "muted",
  hint,
  minor = false,
}: {
  title: string;
  status?: string;
  hint?: string;
  tone?: WalkthroughTone;
  minor?: boolean;
}) {
  return (
    <div
      className={clsx(
        "@max-3xl:mx-2 @max-3xl:border-t @max-3xl:border-hairline",
        minor ? "@max-3xl:my-1.5" : "@max-3xl:mt-2 @max-3xl:mb-1.5",
      )}
    >
      <div
        title={hint}
        className={clsx(
          "flex items-baseline gap-2 px-2.5 @max-3xl:hidden",
          minor ? "pt-2 pb-1" : "pt-4 pb-1.5",
        )}
      >
        <span
          className={clsx(
            "min-w-0 flex-1 truncate",
            minor
              ? "font-mono text-[10px] tracking-wide text-faint uppercase"
              : "text-[12px] font-medium text-ink/80",
          )}
        >
          {title}
        </span>
        {status && (
          <span
            className={clsx(
              "shrink-0 text-[11px]",
              tone === "amber" && "text-amber/90",
              tone === "danger" && "text-danger/80",
              tone === "muted" && "text-muted/80",
              tone === "writing" &&
                "animate-shimmer bg-linear-to-r from-muted via-ink to-muted bg-[length:200%_100%] bg-clip-text text-transparent motion-reduce:animate-none",
            )}
          >
            {status}
          </span>
        )}
      </div>
    </div>
  );
}
