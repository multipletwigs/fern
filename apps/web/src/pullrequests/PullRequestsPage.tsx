import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Callout } from "@repo/ui/Callout";
import { GhostButton } from "@repo/ui/GhostButton";
import { Hint } from "@repo/ui/Hint";
import { LonePullRequests } from "@repo/ui/LonePullRequests";
import { PullRequestStack } from "@repo/ui/PullRequestStack";
import { PullRequestsPanel } from "@repo/ui/PullRequestsPanel";
import { Cause, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useMemo } from "react";
import { projectsAtom } from "../session/atoms";
import { pullRequestListAtom } from "./atoms";
import { ListedPr } from "./ListedPr";
import { usePolling } from "./usePolling";
import { whyFailed } from "./whyFailed";

// How often the page asks GitHub again while it's in sight.
const POLL_EVERY = 60_000;

const projectName = (path: string) => path.split("/").at(-1) || "Unknown";

// A Project's Pull requests page: its open PRs on GitHub, in their Stacks, bottom first, then the
// PRs in no Stack. Fetched when it opens, on Refresh, and every minute while it's in sight. A failed
// fetch says why, with a retry, over the last list fetched.
export function PullRequestsPage({ root }: { root: string }) {
  const atom = pullRequestListAtom(root);
  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);
  usePolling(refresh, POLL_EVERY);
  const projects = useAtomValue(projectsAtom);
  // What the sidebar calls each Session, by its id.
  const titles = useMemo(
    () =>
      new Map(
        AsyncResult.isSuccess(projects)
          ? projects.value.flatMap((p) =>
              p.sessions.map((s) => [s.id, s.title] as const),
            )
          : [],
      ),
    [projects],
  );
  const list = Option.getOrUndefined(AsyncResult.value(result));
  const refreshing = AsyncResult.isInitial(result) || result.waiting;
  const failed = AsyncResult.isFailure(result)
    ? whyFailed(Option.getOrUndefined(Cause.findErrorOption(result.cause)))
    : undefined;

  return (
    <PullRequestsPanel
      name={projectName(root)}
      path={root}
      repo={list?.repo}
      refreshing={refreshing}
      onRefresh={refresh}
      notice={
        failed !== undefined && (
          <Callout
            tone="danger"
            action={<GhostButton onClick={refresh}>Retry</GhostButton>}
          >
            {failed}
          </Callout>
        )
      }
    >
      {list === undefined ? (
        !failed && <Hint text="Asking GitHub for the open pull requests…" />
      ) : list.stacks.length === 0 && list.lone.length === 0 ? (
        <Hint text="No open pull requests." />
      ) : (
        <>
          {list.stacks.map((stack) => (
            <PullRequestStack
              key={stack.id}
              number={stack.number}
              count={stack.prs.length}
              authors={[...new Set(stack.prs.map((pr) => pr.author))]}
            >
              {stack.prs.map((pr) => (
                <ListedPr
                  key={pr.number}
                  pr={pr}
                  sessionTitle={pr.session && titles.get(pr.session)}
                />
              ))}
            </PullRequestStack>
          ))}
          {list.lone.length > 0 && (
            <LonePullRequests>
              {list.lone.map((pr) => (
                <ListedPr
                  key={pr.number}
                  pr={pr}
                  sessionTitle={pr.session && titles.get(pr.session)}
                />
              ))}
            </LonePullRequests>
          )}
        </>
      )}
    </PullRequestsPanel>
  );
}
