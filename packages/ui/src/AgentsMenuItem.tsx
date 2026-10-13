import { Menu } from "@base-ui/react/menu";
import { XIcon } from "@phosphor-icons/react";
import type { SubagentStatus } from "@repo/api";
import { clsx } from "clsx";
import { SubagentStatusMark } from "./SubagentStatusMark";

// One Subagent in the Agents menu: how it stands, what it was asked to do and what kind it is.
// Picking it shows its tab. Its close control, shown while the row is highlighted, or Delete,
// closes its tab and keeps the menu open.
export function AgentsMenuItem({
  description,
  agentType,
  status,
  selected,
  onSelect,
  onClose,
}: {
  description: string;
  agentType: string;
  status: SubagentStatus;
  // Whether its tab is the one showing.
  selected: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  return (
    <Menu.Item
      title={`${agentType}: ${description}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key !== "Delete" && event.key !== "Backspace") return;
        event.preventDefault();
        onClose();
      }}
      className={clsx(
        "group/item flex h-8 cursor-default items-center gap-2 rounded-lg pr-1 pl-2 text-[12px] outline-none data-highlighted:bg-white/[0.06] data-highlighted:text-ink",
        selected ? "text-ink" : "text-muted",
      )}
    >
      <span className="flex size-3 shrink-0 items-center justify-center">
        <SubagentStatusMark status={status} />
      </span>
      <span
        className={clsx(
          "min-w-0 flex-1 truncate",
          status === "failed" && "text-danger/80",
        )}
      >
        {description}
      </span>
      <span className="max-w-24 shrink-0 truncate text-[11px] text-faint">
        {agentType}
      </span>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Close ${agentType}: ${description}`}
        title="Close tab (Delete)"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="flex size-5 shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity group-data-highlighted/item:opacity-100 hover:bg-white/[0.08] hover:text-ink"
      >
        <XIcon className="size-2.5" weight="bold" />
      </button>
    </Menu.Item>
  );
}
