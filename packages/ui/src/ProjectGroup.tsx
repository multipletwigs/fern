import { Collapsible } from "@base-ui/react/collapsible";
import {
  DotsThreeIcon,
  FolderOpenIcon,
  FolderSimpleIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { NewSessionButton } from "./NewSessionButton";

// An Arc-style folder: the icon opens and closes it, and its rows sit indented beneath. Shows the
// first few rows until "Show more" is clicked. Hovering it reveals a button to start a new Session
// in its folder.
export function ProjectGroup({
  name,
  path,
  rows,
  collapsedCount = 5,
  onNew,
}: {
  name: string;
  path: string;
  rows: ReadonlyArray<ReactNode>;
  collapsedCount?: number;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const hidden = rows.length - collapsedCount;
  const FolderIcon = open ? FolderOpenIcon : FolderSimpleIcon;

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="mt-1">
      <div className="group flex h-9 items-center rounded-lg pr-1 transition-colors hover:bg-white/[0.04]">
        <Collapsible.Trigger
          title={path}
          className="flex h-full min-w-0 flex-1 items-center gap-2.5 px-2.5 text-left text-[13px] text-ink/80 transition-colors group-hover:text-ink"
        >
          <FolderIcon className="size-4 shrink-0 text-muted" />
          <span className="truncate font-medium">{name}</span>
        </Collapsible.Trigger>
        <NewSessionButton
          name={name}
          onClick={onNew}
          className="size-7 rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        />
      </div>
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
