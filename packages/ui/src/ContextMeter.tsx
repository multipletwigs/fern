import { Tooltip } from "@base-ui/react/tooltip";
import { clsx } from "clsx";
import { CacheDetails, type PromptCacheFacts } from "./CacheDetails";
import { ContextDetails } from "./ContextDetails";
import { compactTokens } from "./tokens";
import { TooltipPanel } from "./TooltipPanel";

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// How full the Session's context window is: a ring and the tokens in it, out of the window's size
// when that's known. Turns amber past 70% and red past 90%, as compaction nears. Resting the
// pointer on it shows the context and the prompt cache in full.
export function ContextMeter({
  tokens,
  limit,
  cache,
  now,
}: {
  tokens: number;
  limit: number | undefined;
  cache: PromptCacheFacts | undefined;
  now: number;
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
    <Tooltip.Root>
      <Tooltip.Trigger
        delay={150}
        render={
          <span
            className={clsx(
              "flex cursor-default items-center gap-1.5 px-1 font-mono text-[11px] tabular-nums",
              tone,
            )}
          />
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
          ? `${compactTokens(tokens)} / ${compactTokens(limit)}`
          : `${compactTokens(tokens)} context`}
      </Tooltip.Trigger>
      <TooltipPanel>
        <div className="flex flex-col gap-2.5 py-1">
          <ContextDetails tokens={tokens} limit={limit} />
          {cache && <CacheDetails cache={cache} now={now} />}
        </div>
      </TooltipPanel>
    </Tooltip.Root>
  );
}
