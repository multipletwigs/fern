import { clsx } from "clsx";
import { Loader } from "./Loader";

// Where the Session's latest Walkthrough stands, just above the composer: being written, waiting
// on the developer's review, or failed. Clicking it opens the Walkthrough.
export function WalkthroughStatus({
  number,
  status,
  open,
  onOpen,
}: {
  number: number;
  status: "writing" | "ready" | "failed";
  // Items still waiting on a verdict.
  open: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        "mb-2 flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[13px] transition-colors",
        status === "failed"
          ? "bg-danger/[0.06] text-danger/85 hover:bg-danger/[0.1]"
          : "bg-white/[0.035] text-ink/75 hover:bg-white/[0.06] hover:text-ink",
      )}
    >
      {status === "writing" && (
        <Loader label="Writing" className="shrink-0 text-sm text-muted" />
      )}
      <span className="min-w-0 flex-1 truncate">
        {status === "writing"
          ? `Writing Walkthrough ${number}…`
          : status === "failed"
            ? `Walkthrough ${number} couldn't be written`
            : `Walkthrough ${number} is ready`}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-faint">
        {status === "ready"
          ? `${open} to review`
          : status === "failed"
            ? "Details"
            : "Open"}
      </span>
    </button>
  );
}
