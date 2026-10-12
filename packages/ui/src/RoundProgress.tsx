// How far through a Round of questions the developer is: a thin bar that fills as they answer.
export function RoundProgress({
  answered,
  total,
}: {
  answered: number;
  total: number;
}) {
  const share = total === 0 ? 0 : Math.min(1, answered / total);
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={answered}
        aria-label="Questions answered"
        className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/[0.06]"
      >
        <div
          className="h-full rounded-full bg-ice/80 shadow-[0_0_12px_rgb(159_216_255/0.5)] transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ width: `${share * 100}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-[11px] text-faint tabular-nums">
        {answered}/{total}
      </span>
    </div>
  );
}
