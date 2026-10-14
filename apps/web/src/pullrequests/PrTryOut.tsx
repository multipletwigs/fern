import { useAtom } from "@effect/atom-react";
import type { ListedPullRequest } from "@repo/api";
import { TerminalToggle } from "@repo/ui/TerminalToggle";
import { terminalKeyOf, terminalOpenAtom } from "../terminal/atoms";
import { DismissWorktree } from "./DismissWorktree";
import { TryItButton } from "./TryItButton";

// A Foreign PR's Try it controls, in its top bar: Try it while it's open, then, once it has a
// worktree, the button that shows and hides its Terminal and Dismiss. A closed or merged PR can't
// be tried, but a worktree it still has can be dismissed.
export function PrTryOut({
  root,
  repo,
  pr,
  onChanged,
}: {
  root: string;
  repo: string;
  pr: ListedPullRequest;
  // Told when the worktree is checked out or removed, for the list to show it.
  onChanged: () => void;
}) {
  const key = terminalKeyOf({ _tag: "PullRequest", repo, number: pr.number });
  const [open, setOpen] = useAtom(terminalOpenAtom(key));
  return (
    <>
      {pr.worktree !== undefined && (
        <>
          <TerminalToggle open={open} onToggle={() => setOpen(!open)} />
          <DismissWorktree
            root={root}
            number={pr.number}
            terminalKey={key}
            onDismissed={onChanged}
          />
        </>
      )}
      {pr.state === "open" && (
        <TryItButton
          root={root}
          number={pr.number}
          terminalKey={key}
          onTried={onChanged}
        />
      )}
    </>
  );
}
