import { HourglassMediumIcon } from "@phosphor-icons/react";

interface Wait {
  readonly pr?: { number: number; title: string; url: string };
  readonly why: string;
}

// What a Session's Stack still waits on before it can Land, one line each: the PR it's about, when
// it's about one, and why.
export function LandWaits({ waiting }: { waiting: ReadonlyArray<Wait> }) {
  return (
    <ul aria-label="Land waits on" className="mt-3 space-y-1.5">
      {waiting.map((wait, i) => (
        <li
          // The same PR can wait on more than one thing.
          // oxlint-disable-next-line react/no-array-index-key
          key={`${wait.pr?.number ?? "stack"}-${i}`}
          className="flex items-start gap-2.5 text-[13px] leading-5"
        >
          <HourglassMediumIcon
            weight="bold"
            className="mt-1 size-3 shrink-0 text-amber/80"
          />
          <span className="min-w-0 flex-1 text-muted">
            {wait.pr && (
              <a
                href={wait.pr.url}
                target="_blank"
                rel="noreferrer"
                className="mr-1.5 text-ink/85 hover:text-ink"
              >
                <span className="font-mono text-[11px] text-faint tabular-nums">
                  #{wait.pr.number}
                </span>{" "}
                {wait.pr.title}
              </a>
            )}
            {wait.why}
          </span>
        </li>
      ))}
    </ul>
  );
}
