import type { Hunk } from "@repo/api";
import { FileTabs } from "@repo/ui/FileTabs";
import { HunkView } from "@repo/ui/HunkView";
import { useState } from "react";
import { byFile } from "./review";

// The files a Section claims hunks in, one file's diff at a time, starting with the first.
export function SectionFiles({ hunks }: { hunks: ReadonlyArray<Hunk> }) {
  const files = byFile(hunks);
  const [chosen, setChosen] = useState<string>();
  const selected = files.find(([path]) => path === chosen) ?? files[0];
  if (selected === undefined) return null;
  const [path, fileHunks] = selected;
  return (
    <FileTabs
      paths={files.map(([file]) => file)}
      value={path}
      onChange={setChosen}
    >
      {fileHunks.map((hunk) => (
        <HunkView
          key={hunk.id}
          path={hunk.path}
          header={hunk.header}
          lines={hunk.lines}
          omitted={hunk.omitted}
        />
      ))}
    </FileTabs>
  );
}
