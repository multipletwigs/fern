import { clsx } from "clsx";

// A Subagent's tab: what it was asked to do, trailing a quiet dot while it runs. A failed one is
// tinted red.
export function SubagentTabLabel({
  description,
  status,
}: {
  description: string;
  status: "running" | "done" | "failed";
}) {
  return (
    <>
      <span
        className={clsx(
          "max-w-[9rem] truncate",
          status === "failed" && "text-danger/80",
        )}
      >
        {description}
      </span>
      {status === "running" && (
        <span
          aria-label="running"
          className="size-1 shrink-0 rounded-full bg-ink/60 motion-safe:animate-pulse"
        />
      )}
    </>
  );
}
