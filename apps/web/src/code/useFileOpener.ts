import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { activeProjectAtom, activeSessionIdAtom } from "../session/atoms";
import { openAtom } from "./atoms";
import { relativeTo } from "./paths";

// Returns how to open a path in the code panel, or undefined for paths outside the open Project.
export const useFileOpener = () => {
  const sessionId = useAtomValue(activeSessionIdAtom);
  const project = useAtomValue(activeProjectAtom);
  const open = useAtomSet(openAtom(sessionId ?? ""));
  return (path: string | undefined) =>
    path !== undefined &&
    project !== undefined &&
    relativeTo(project.path, path) !== undefined
      ? () => open({ kind: "file", path })
      : undefined;
};
