import { Workbench } from "@repo/ui/Workbench";
import { PrTerminal } from "./PrTerminal";
import { PullRequestsPage } from "./PullRequestsPage";

// A Project's Pull requests page, with the Terminal of the Foreign PR open on it underneath, once
// Try it has checked the PR out.
export function PullRequestsWorkbench({ root }: { root: string }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Workbench
        chat={<PullRequestsPage root={root} />}
        code={undefined}
        animate={false}
      />
      <PrTerminal root={root} />
    </div>
  );
}
