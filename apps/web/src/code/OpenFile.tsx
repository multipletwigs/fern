import { useAtomValue } from "@effect/atom-react";
import type { FileContent } from "@repo/api";
import { CodeView } from "@repo/ui/CodeView";
import { Empty } from "@repo/ui/Empty";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { fileAtom } from "./atoms";

export function OpenFile({ root, path }: { root: string; path: string }) {
  const file = useAtomValue(fileAtom(root)(path));
  // Keep the last file on screen while the next one loads, instead of flashing a placeholder.
  const [shown, setShown] = useState<FileContent>();
  if (AsyncResult.isSuccess(file) && file.value !== shown) setShown(file.value);

  if (AsyncResult.isFailure(file))
    return <Empty text={`Can't open ${path}.`} />;
  if (shown === undefined) return <Empty text={`Opening ${path}…`} />;
  if (shown.skipped === "binary")
    return <Empty text={`${shown.path} is a binary file.`} />;
  if (shown.skipped === "tooLarge")
    return <Empty text={`${shown.path} is too large to show.`} />;
  return <CodeView path={shown.path} content={shown.content} />;
}
