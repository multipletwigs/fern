import { IssueLink } from "./IssueLink";

interface Issue {
  number: number;
  title: string;
  url: string;
}

// What Spec wrote, for the developer to approve: the Brief and the tickets that implement it.
export function SpecIssues({
  brief,
  tickets,
}: {
  brief: Issue;
  tickets: ReadonlyArray<Issue>;
}) {
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-hairline bg-white/[0.02] p-1.5">
      <section aria-label="Brief">
        <p className="px-2.5 pt-1 font-mono text-[10px] tracking-wide text-faint uppercase">
          Brief
        </p>
        <IssueLink {...brief} prominent />
      </section>
      <section aria-label="Tickets">
        <p className="px-2.5 font-mono text-[10px] tracking-wide text-faint uppercase">
          Tickets · {tickets.length}
        </p>
        <ul className="space-y-px">
          {tickets.map((ticket) => (
            <li key={ticket.number}>
              <IssueLink {...ticket} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
