import { useAtomValue } from "@effect/atom-react";
import { Empty } from "@repo/ui/Empty";
import { AsyncResult } from "effect/reactivity";
import { currentSessionAtom, selectedSessionAtom } from "./atoms";
import { Session } from "./Session";

export function SessionScreen() {
  const selected = useAtomValue(selectedSessionAtom);
  const current = useAtomValue(currentSessionAtom);
  // Keyed by id so switching Sessions starts a fresh list, scrolled to the end.
  if (selected) return <Session key={selected} id={selected} />;
  if (AsyncResult.isSuccess(current))
    return <Session key={current.value.id} id={current.value.id} />;
  return (
    <Empty
      text={
        AsyncResult.isFailure(current)
          ? "No Claude Code sessions found yet."
          : "Looking for your latest session…"
      }
    />
  );
}
