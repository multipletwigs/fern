import { Collapsible } from "@base-ui/react/collapsible";
import {
  DotsThreeIcon,
  FolderOpenIcon,
  FolderSimpleIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";

// An Arc-style folder: the icon opens and closes it, and its rows sit indented beneath. Shows the
// first few rows until "Show more" is clicked.
export function ProjectGroup({
  name,
  path,
  rows,
  collapsedCount = 5,
}: {
  name: string;
  path: string;
  rows: ReadonlyArray<ReactNode>;
  collapsedCount?: number;
}) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const hidden = rows.length - collapsedCount;
  const FolderIcon = open ? FolderOpenIcon : FolderSimpleIcon;

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="mt-1">
      <Collapsible.Trigger
        title={path}
        className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-ink/80 transition-colors hover:bg-white/[0.04] hover:text-ink"
      >
        <FolderIcon className="size-4 shrink-0 text-muted" />
        <span className="truncate font-medium">{name}</span>
      </Collapsible.Trigger>
      <Collapsible.Panel className="ml-[19px] space-y-px border-l border-hairline pl-1.5">
        {expanded ? rows : rows.slice(0, collapsedCount)}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-xs text-faint transition-colors hover:bg-white/[0.04] hover:text-muted"
          >
            <DotsThreeIcon weight="bold" className="size-4 shrink-0" />
            {expanded ? "Show less" : `${hidden} more`}
          </button>
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
