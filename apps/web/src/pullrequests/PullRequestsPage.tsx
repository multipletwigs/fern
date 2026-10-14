import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react";
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
import {
  openPullRequestAtom,
  pullRequestFiltersAtom,
  pullRequestListAtom,
} from "./atoms";
import { ForeignPrReview } from "./ForeignPrReview";
import { listStateOf, rowsOf } from "./list";
import { WalkThroughStackButton } from "./WalkThroughStackButton";
import { ListedPr } from "./ListedPr";
import { NothingListed } from "./NothingListed";
import { walkable, walkthroughOf } from "./prWalkthroughs";
import { PullRequestFiltersBar } from "./PullRequestFiltersBar";
import { useLiveWalkthroughs } from "./useLiveWalkthroughs";
import { usePolling } from "./usePolling";
import { whyFailed } from "./whyFailed";

// How often the page asks GitHub again while it's in sight.
const POLL_EVERY = 60_000;

const projectName = (path: string) => path.split("/").at(-1) || "Unknown";

// A Project's Pull requests page: its PRs on GitHub, in their Stacks, bottom first, then the PRs in
// no Stack, narrowed by the filters, the developer's own open PRs to start with. A Stack only some
// of whose PRs pass shows whole, the rest dimmed. Fetched when it opens, on Refresh, and every minute
// while it's in sight. A failed fetch says why, with a retry, over the last list fetched. A Foreign
// PR opens here, in place of the list, on its Walkthroughs.
export function PullRequestsPage({ root }: { root: string }) {
  const [filters, setFilters] = useAtom(pullRequestFiltersAtom(root));
  const [open, setOpen] = useAtom(openPullRequestAtom(root));
  const atom = pullRequestListAtom(root, listStateOf(filters));
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
  const live = useLiveWalkthroughs(list?.repo);
  const rows = useMemo(
    () => (list === undefined ? undefined : rowsOf(list, filters, live)),
    [list, filters, live],
  );
  const refreshing = AsyncResult.isInitial(result) || result.waiting;
  const failed = AsyncResult.isFailure(result)
    ? whyFailed(Option.getOrUndefined(Cause.findErrorOption(result.cause)))
    : undefined;

  if (open !== undefined && list !== undefined) {
    const pr = [...list.lone, ...list.stacks.flatMap((s) => s.prs)].find(
      (listed) => listed.number === open,
    );
    return (
      <ForeignPrReview
        key={open}
        root={root}
        repo={list.repo}
        number={open}
        pr={pr}
        latest={pr && walkthroughOf(pr, live)}
        onBack={() => setOpen(undefined)}
        onChanged={refresh}
      />
    );
  }

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
      <PullRequestFiltersBar
        filters={filters}
        list={list}
        onChange={setFilters}
      />
      {rows === undefined ? (
        !failed && <Hint text="Asking GitHub for the pull requests…" />
      ) : rows.empty !== undefined ? (
        <NothingListed empty={rows.empty} onClear={setFilters} />
      ) : (
        <>
          {rows.stacks.map(({ stack, prs }) => (
            <PullRequestStack
              key={stack.id}
              number={stack.number}
              count={prs.length}
              authors={[...new Set(prs.map(({ pr }) => pr.author))]}
              action={
                prs.some(({ pr }) => pr.session === undefined) && (
                  <WalkThroughStackButton
                    root={root}
                    id={stack.id}
                    state={listStateOf(filters)}
                    disabled={
                      !prs.some(({ pr }) =>
                        walkable(pr, walkthroughOf(pr, live)),
                      )
                    }
                  />
                )
              }
            >
              {prs.map(({ pr, dimmed }) => (
                <ListedPr
                  key={pr.number}
                  pr={pr}
                  sessionTitle={pr.session && titles.get(pr.session)}
                  dimmed={dimmed}
                  walkthrough={walkthroughOf(pr, live)}
                  onOpen={() => setOpen(pr.number)}
                />
              ))}
            </PullRequestStack>
          ))}
          {rows.lone.length > 0 && (
            <LonePullRequests>
              {rows.lone.map((pr) => (
                <ListedPr
                  key={pr.number}
                  pr={pr}
                  sessionTitle={pr.session && titles.get(pr.session)}
                  dimmed={false}
                  walkthrough={walkthroughOf(pr, live)}
                  onOpen={() => setOpen(pr.number)}
                />
              ))}
            </LonePullRequests>
          )}
        </>
      )}
    </PullRequestsPanel>
  );
}
