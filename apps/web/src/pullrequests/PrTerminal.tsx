import { useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { TerminalDock } from "../terminal/TerminalDock";
import {
  openPullRequestAtom,
  pullRequestFiltersAtom,
  pullRequestListAtom,
} from "./atoms";
import { listStateOf } from "./list";

// The Terminal along the bottom of the Pull requests page, in the worktree Try it checked out for
// the Foreign PR open on it. None for a PR with no worktree. Its shell runs on while the page shows
// another PR or the list, and coming back shows what it printed.
export function PrTerminal({ root }: { root: string }) {
  const filters = useAtomValue(pullRequestFiltersAtom(root));
  const open = useAtomValue(openPullRequestAtom(root));
  const result = useAtomValue(pullRequestListAtom(root, listStateOf(filters)));
  const list = Option.getOrUndefined(AsyncResult.value(result));
  if (open === undefined || list === undefined) return null;
  const pr = [...list.lone, ...list.stacks.flatMap((s) => s.prs)].find(
    (listed) => listed.number === open,
  );
  if (pr?.worktree === undefined || pr.session !== undefined) return null;
  return (
    <TerminalDock
      key={`${root}:${list.repo}#${open}`}
      target={{ _tag: "PullRequest", root, repo: list.repo, number: open }}
      // The worktree stays where it is as it moves from one head to the next.
      folder={`${root}:${list.repo}#${open}`}
    />
  );
}
