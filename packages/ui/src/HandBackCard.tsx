import { Markdown } from "./Markdown";

// A Subagent's final answer, set apart at the end of its tab.
export function HandBackCard({ children }: { children: string }) {
  return (
    <div className="mt-6 mb-4 rounded-xl border border-hairline bg-white/[0.03] px-5 py-3">
      <div className="text-xs tracking-wide text-faint uppercase">
        Hand-back
      </div>
      <Markdown>{children}</Markdown>
    </div>
  );
}
