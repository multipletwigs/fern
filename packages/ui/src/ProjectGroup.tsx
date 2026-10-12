import { Collapsible } from "@base-ui/react/collapsible";
import {
  DotsThreeIcon,
  FolderOpenIcon,
  FolderSimpleIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { NewSessionButton } from "./NewSessionButton";

// An Arc-style section: a quiet, muted header opens and closes it, with its rows beneath. Shows
// the first few rows until "Show more" is clicked. Hovering it reveals a button to start a new
// Session in its folder.
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
    <Collapsible.Root open={open} onOpenChange={setOpen} className="mt-3 first:mt-0">
      <div className="group flex h-7 items-center rounded-md pr-0.5">
        <Collapsible.Trigger
          title={path}
          className="side-heading h-full min-w-0 flex-1 text-left group-hover:text-ink/85"
        >
          <FolderIcon className="size-3.5 shrink-0 opacity-70" />
          <span className="truncate">{name}</span>
        </Collapsible.Trigger>
        <NewSessionButton
          name={name}
          onClick={onNew}
          className="size-6 rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        />
      </div>
      <Collapsible.Panel className="mt-0.5 space-y-0.5">
        {expanded ? rows : rows.slice(0, collapsedCount)}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="side-row h-7 gap-2 px-2.5 text-left text-xs text-muted"
          >
            <DotsThreeIcon weight="bold" className="size-3.5 shrink-0" />
            {expanded ? "Show less" : `${hidden} more`}
          </button>
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
