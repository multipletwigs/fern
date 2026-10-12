import { Markdown } from "./Markdown";

// The prompt the agent gave a Subagent, at the top of the Subagent's view: who it went to, then the
// prompt in full.
export function AssignmentCard({
  agentType,
  description,
  children,
}: {
  agentType: string;
  description: string;
  children: string;
}) {
  return (
    <div className="mt-8 mb-4 rounded-xl border border-hairline px-5 py-3">
      <div className="flex min-w-0 items-baseline gap-2 text-xs text-faint">
        <span className="shrink-0 tracking-wide uppercase">Assignment</span>
        <span className="shrink-0 font-mono text-ink/70">{agentType}</span>
        <span className="truncate">{description}</span>
      </div>
      <Markdown>{children}</Markdown>
    </div>
  );
}
