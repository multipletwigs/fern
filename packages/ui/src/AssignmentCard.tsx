import { Markdown } from "./Markdown";

// The prompt the agent gave a Subagent, in full, near the top of the Subagent's view.
export function AssignmentCard({ children }: { children: string }) {
  return (
    <div className="mt-4 mb-4 rounded-xl border border-hairline px-5 py-3">
      <div className="text-xs tracking-wide text-faint uppercase">
        Assignment
      </div>
      <Markdown>{children}</Markdown>
    </div>
  );
}
