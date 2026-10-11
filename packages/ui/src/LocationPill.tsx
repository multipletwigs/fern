// The sidebar's address bar: where the open Session runs, as Arc shows the current URL.
export function LocationPill({
  primary,
  secondary,
}: {
  primary: string;
  secondary?: string;
}) {
  return (
    <div className="flex h-9 items-center gap-1.5 truncate rounded-lg bg-white/[0.05] px-3 text-[13px]">
      <span className="truncate text-ink/90">{primary}</span>
      {secondary && (
        <span className="truncate font-mono text-[11px] text-faint">
          {secondary}
        </span>
      )}
    </div>
  );
}
