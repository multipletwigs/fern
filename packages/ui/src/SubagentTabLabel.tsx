import type { SubagentStatus } from "@repo/api";
import { clsx } from "clsx";
import { SubagentStatusMark } from "./SubagentStatusMark";

// A Subagent's tab: what it was asked to do, then a small mark for how it stands. A failed one is
// tinted red.
export function SubagentTabLabel({
  description,
  status,
}: {
  description: string;
  status: SubagentStatus;
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
      <SubagentStatusMark status={status} />
    </>
  );
}
