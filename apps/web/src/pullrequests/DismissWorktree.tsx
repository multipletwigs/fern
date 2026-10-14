import { useAtomSet } from "@effect/atom-react";
import { ConfirmDialog } from "@repo/ui/ConfirmDialog";
import { GhostButton } from "@repo/ui/GhostButton";
import { Cause, Exit, Option } from "effect";
import { useState } from "react";
import { terminalOpenAtom } from "../terminal/atoms";
import { dismissWorktreeAtom } from "./atoms";
import { whyNotTried } from "./whyNotTried";

// Why the dialog is open: the worktree has changes not committed, or removing it failed.
type Asking =
  | { readonly reason: "uncommitted" }
  | {
      readonly reason: "failed";
      readonly why: string;
      readonly discard: boolean;
    };

// Removes a Foreign PR's worktree and ends the shell in its Terminal. With changes not committed
// in it, the developer is asked before they're thrown away.
export function DismissWorktree({
  root,
  number,
  terminalKey,
  onDismissed,
}: {
  root: string;
  number: number;
  // The PR's Terminal, as `terminalKeyOf` keys it.
  terminalKey: string;
  onDismissed: () => void;
}) {
  const dismiss = useAtomSet(dismissWorktreeAtom, { mode: "promiseExit" });
  const hideTerminal = useAtomSet(terminalOpenAtom(terminalKey));
  const [asking, setAsking] = useState<Asking>();
  const [pending, setPending] = useState(false);

  const run = async (discard: boolean) => {
    setPending(true);
    const exit = await dismiss({
      params: { number },
      payload: { root, discard },
    });
    setPending(false);
    if (Exit.isSuccess(exit)) {
      setAsking(undefined);
      hideTerminal(false);
      onDismissed();
      return;
    }
    const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
    setAsking(
      error?._tag === "PrUncommittedChanges"
        ? { reason: "uncommitted" }
        : { reason: "failed", why: whyNotTried(error), discard },
    );
  };

  return (
    <>
      <GhostButton disabled={pending} onClick={() => void run(false)}>
        Dismiss
      </GhostButton>
      <ConfirmDialog
        open={asking !== undefined}
        onOpenChange={(open) => {
          if (!open) setAsking(undefined);
        }}
        title={
          asking?.reason === "failed"
            ? "Couldn't remove this PR's worktree"
            : "Throw away your changes?"
        }
        description={
          asking?.reason === "failed"
            ? asking.why
            : `The worktree of PR #${number} has changes that aren't committed. Dismissing it removes the worktree and throws them away, and ends its Terminal.`
        }
        confirmLabel={
          asking?.reason === "failed" ? "Try again" : "Discard and dismiss"
        }
        pending={pending}
        onConfirm={() =>
          void run(asking?.reason === "failed" ? asking.discard : true)
        }
      />
    </>
  );
}
