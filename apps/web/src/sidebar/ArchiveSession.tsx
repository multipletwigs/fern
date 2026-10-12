import { useAtomSet } from "@effect/atom-react";
import { ArchiveButton } from "@repo/ui/ArchiveButton";
import { ConfirmDialog } from "@repo/ui/ConfirmDialog";
import { Cause, Exit, Option } from "effect";
import { useState } from "react";
import { archiveSessionAtom } from "../session/atoms";

// Why the dialog is open: the worktree has uncommitted changes, or archiving failed.
type Asking =
  | { readonly reason: "uncommitted" }
  | { readonly reason: "failed"; readonly force: boolean };

// Archives a worktree Session: its worktree is removed and it leaves the sidebar. With uncommitted
// changes in the worktree, the developer is asked before they're thrown away.
export function ArchiveSession({
  sessionId,
  title,
  onArchived,
}: {
  sessionId: string;
  title: string;
  onArchived: () => void;
}) {
  const archive = useAtomSet(archiveSessionAtom, { mode: "promiseExit" });
  const [asking, setAsking] = useState<Asking>();
  const [pending, setPending] = useState(false);

  const run = async (force: boolean) => {
    setPending(true);
    const exit = await archive({
      params: { id: sessionId },
      payload: { force },
    });
    setPending(false);
    if (Exit.isSuccess(exit)) {
      setAsking(undefined);
      onArchived();
      return;
    }
    const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
    setAsking(
      error?._tag === "UncommittedChanges"
        ? { reason: "uncommitted" }
        : { reason: "failed", force },
    );
  };

  return (
    <>
      <ArchiveButton
        name={title}
        disabled={pending}
        onClick={() => void run(false)}
      />
      <ConfirmDialog
        open={asking !== undefined}
        onOpenChange={(open) => {
          if (!open) setAsking(undefined);
        }}
        title={
          asking?.reason === "failed"
            ? "Couldn't archive this session"
            : "Archive with uncommitted changes?"
        }
        description={
          asking?.reason === "failed"
            ? `Fern couldn't remove the worktree of "${title}".`
            : `The worktree of "${title}" has changes that aren't committed. Archiving removes the worktree and throws them away. The branch is kept.`
        }
        confirmLabel={
          asking?.reason === "failed" ? "Try again" : "Archive anyway"
        }
        pending={pending}
        onConfirm={() =>
          void run(asking?.reason === "failed" ? asking.force : true)
        }
      />
    </>
  );
}
