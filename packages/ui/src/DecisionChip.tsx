import { CaretDownIcon, SealCheckIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";
import { useId, useState } from "react";

// A Decision a Section cites, as a chip titled by its question. Clicked, it opens in place to the
// question, what the agent recommended, and the developer's answer in their own words.
export function DecisionChip({
  question,
  recommendation,
  choice,
  freeText,
  earlier,
}: {
  question: string;
  recommendation: string;
  choice?: string;
  freeText?: string;
  // Settled in an earlier Session of the Project.
  earlier: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <div
      className={clsx(
        "min-w-0 border transition-colors",
        open
          ? "basis-full rounded-xl border-white/[0.1] bg-white/[0.03]"
          : "max-w-full rounded-full border-hairline bg-white/[0.03] hover:border-white/[0.14] hover:bg-white/[0.05]",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((was) => !was)}
        className={clsx(
          "flex w-full min-w-0 items-center gap-1.5 text-left text-[12px] text-ink/80",
          open ? "px-3 pt-2.5 pb-1" : "h-7 px-2.5",
        )}
      >
        <SealCheckIcon
          weight="fill"
          className="size-3.5 shrink-0 text-mint/80"
        />
        <span
          className={clsx(
            "min-w-0",
            open ? "flex-1 font-medium text-ink" : "truncate",
          )}
        >
          {question}
        </span>
        <CaretDownIcon
          weight="bold"
          className={clsx(
            "size-2.5 shrink-0 text-faint transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div
          id={panel}
          className="space-y-2 px-3 pt-1 pb-3 pl-8 text-[13px] leading-5"
        >
          <blockquote className="border-l-2 border-mint/40 pl-3 text-ink">
            {choice && <p>“{choice}”</p>}
            {freeText && <p className="text-ink/80 italic">“{freeText}”</p>}
          </blockquote>
          <p className="text-[12px] text-muted">
            <span className="text-faint">The agent recommended: </span>
            {recommendation}
            {choice === recommendation && ", and you agreed"}
          </p>
          {earlier && (
            <p className="text-[12px] text-faint">
              Settled in an earlier Session
            </p>
          )}
        </div>
      )}
    </div>
  );
}
