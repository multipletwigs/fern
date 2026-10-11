// A commit Claude made in this Session: its subject, and its short hash when known.
export function CommitRow({
  subject,
  hash,
}: {
  subject: string;
  hash: string | undefined;
}) {
  return (
    <div
      title={hash ? `${hash} ${subject}` : subject}
      className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] text-ink/65"
    >
      <span className="min-w-0 flex-1 truncate">{subject}</span>
      {hash && (
        <span className="shrink-0 font-mono text-[11px] text-faint">
          {hash}
        </span>
      )}
    </div>
  );
}
