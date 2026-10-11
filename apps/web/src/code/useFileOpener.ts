import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { activeProjectAtom, activeSessionIdAtom } from "../session/atoms";
import { openFileAtom } from "./atoms";
import { relativeTo } from "./paths";

// Returns how to open a path in the code panel, or undefined for paths outside the open Project.
export const useFileOpener = () => {
  const sessionId = useAtomValue(activeSessionIdAtom);
  const project = useAtomValue(activeProjectAtom);
  const open = useAtomSet(openFileAtom(sessionId ?? ""));
  return (path: string | undefined) =>
    path !== undefined &&
    project !== undefined &&
    relativeTo(project.path, path) !== undefined
      ? () => open(path)
      : undefined;
};
