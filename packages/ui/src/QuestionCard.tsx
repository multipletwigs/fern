import { clsx } from "clsx";

// A question the agent asked, its options, and the ones the developer picked.
export function QuestionCard({
  header,
  question,
  options,
  picked,
}: {
  header: string;
  question: string;
  options: ReadonlyArray<string>;
  picked: ReadonlyArray<string>;
}) {
  return (
    <div className="my-6 rounded-2xl border border-hairline bg-white/[0.02] p-5">
      <p className="text-xs tracking-wide text-ice/80 uppercase">{header}</p>
      <p className="mt-2 text-[15px] leading-6">{question}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {options.map((label) => (
          <span
            key={label}
            className={clsx(
              "rounded-full border px-3 py-1 text-sm",
              picked.includes(label)
                ? "border-amber/40 bg-amber/10 text-amber"
                : "border-hairline text-muted",
            )}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
