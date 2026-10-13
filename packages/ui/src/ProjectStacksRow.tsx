import { clsx } from "clsx";

// One Project in Settings, with the switch for whether its Hosted Sessions land as a GitHub Stack.
// Until the setting is read, `stacks` is undefined and the switch is off and disabled.
export function ProjectStacksRow({
  name,
  path,
  stacks,
  saving,
  failed,
  onChange,
}: {
  name: string;
  path: string;
  stacks: boolean | undefined;
  saving: boolean;
  // Why the setting couldn't be read or saved, when it couldn't.
  failed?: string | undefined;
  onChange: (stacks: boolean) => void;
}) {
  const on = stacks === true;
  const label = `Land ${name} as a GitHub Stack`;
  return (
    <li className="flex items-center gap-4 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex h-6 items-baseline gap-2.5">
          <span className="text-[14px] text-ink">{name}</span>
          <span className="truncate font-mono text-xs text-faint">{path}</span>
        </div>
        <p className="text-[13px] text-muted">
          {failed ?? (on ? "Lands as a GitHub Stack" : "Lands as before")}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        title={label}
        disabled={stacks === undefined || saving}
        onClick={() => onChange(!on)}
        className={clsx(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
          on ? "bg-ice/70" : "bg-white/[0.12]",
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 left-0.5 size-4 rounded-full bg-ink transition-transform",
            on && "translate-x-4",
          )}
        />
      </button>
    </li>
  );
}
