import { clsx } from "clsx";

const compact = (tokens: number) =>
  tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`
    : tokens >= 1_000
      ? `${Math.round(tokens / 1_000)}k`
      : String(tokens);

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// How full the Session's context window is: a ring and the tokens in it, out of the window's size
// when that's known. Turns amber past 70% and red past 90%, as compaction nears.
export function ContextMeter({
  tokens,
  limit,
}: {
  tokens: number;
  limit: number | undefined;
}) {
  const share = limit ? Math.min(1, tokens / limit) : undefined;
  const tone =
    share === undefined
      ? "text-muted"
      : share >= 0.9
        ? "text-danger"
        : share >= 0.7
          ? "text-amber"
          : "text-muted";
  return (
    <span
      className={clsx(
        "flex items-center gap-1.5 px-1 font-mono text-[11px] tabular-nums",
        tone,
      )}
      title={
        limit
          ? `${tokens.toLocaleString()} of ${limit.toLocaleString()} tokens in context`
          : `${tokens.toLocaleString()} tokens in context`
      }
    >
      {share !== undefined && (
        <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90">
          <circle
            cx="8"
            cy="8"
            r={RADIUS}
            fill="none"
            strokeWidth="2"
            className="stroke-white/10"
          />
          <circle
            cx="8"
            cy="8"
            r={RADIUS}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - share)}
            className="stroke-current"
          />
        </svg>
      )}
      {limit
        ? `${compact(tokens)} / ${compact(limit)}`
        : `${compact(tokens)} context`}
    </span>
  );
}
