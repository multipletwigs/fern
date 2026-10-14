import { useAtom, useAtomValue } from "@effect/atom-react";
import { PullRequestsRow } from "@repo/ui/PullRequestsRow";
import { AsyncResult } from "effect/reactivity";
import { pullRequestsAvailableAtom } from "../pullrequests/atoms";
import { pullRequestsPageAtom, settingsOpenAtom } from "../workspace/showing";

// A Project's Pull requests entry in its sidebar group, only for a Project on GitHub with `gh`
// signed in.
export function PullRequestsEntry({ root }: { root: string }) {
  const available = useAtomValue(pullRequestsAvailableAtom(root));
  const [open, setOpen] = useAtom(pullRequestsPageAtom);
  const settingsOpen = useAtomValue(settingsOpenAtom);
  if (!AsyncResult.isSuccess(available) || !available.value.available)
    return null;
  return (
    <PullRequestsRow
      active={!settingsOpen && open === root}
      onSelect={() => setOpen(root)}
    />
  );
}
