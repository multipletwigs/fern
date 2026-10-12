import type { ReactNode } from "react";
import { TabBar } from "./TabBar";

// The shortest tail of a path that no other path in the list shares, so two `index.ts` tabs read
// apart.
const shortName = (path: string, paths: ReadonlyArray<string>) => {
  const parts = path.split("/");
  for (let take = 1; take < parts.length; take++) {
    const tail = parts.slice(-take).join("/");
    if (paths.every((other) => other === path || !other.endsWith(`/${tail}`)))
      return tail;
  }
  return path;
};

// Several files' hunks in one sunken well, one file at a time: a tab per file, named by its file
// name, over the selected file's full path and its hunks.
export function FileTabs({
  paths,
  value,
  onChange,
  children,
}: {
  paths: ReadonlyArray<string>;
  value: string;
  onChange: (path: string) => void;
  // The selected file's hunks.
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-white/[0.02]">
      <div className="overflow-x-auto border-b border-hairline px-1.5 py-1 [scrollbar-width:none]">
        <TabBar
          label="Files"
          tabs={paths.map((path) => ({
            value: path,
            label: <span className="font-mono">{shortName(path, paths)}</span>,
            title: path,
          }))}
          value={value}
          onChange={onChange}
        />
      </div>
      <div className="truncate px-3 pt-2 font-mono text-[11px] text-faint">
        {value}
      </div>
      <div role="tabpanel" className="divide-y divide-hairline py-1">
        {children}
      </div>
    </div>
  );
}
