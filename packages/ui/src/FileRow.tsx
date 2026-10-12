// A file Claude touched in this Session: its name, its folder, and for a changed file the lines
// added and removed. Lifted like a sidebar tab while it's the file on screen.
export function FileRow({
  path,
  added = 0,
  removed = 0,
  active,
  onSelect,
}: {
  // Relative to the Project's folder.
  path: string;
  // Lines added and removed; omitted for a file Claude only read.
  added?: number;
  removed?: number;
  active: boolean;
  onSelect: () => void;
}) {
  const name = path.split("/").at(-1) ?? path;
  const folder = path.slice(0, -name.length - 1);
  return (
    <button
      type="button"
      onClick={onSelect}
      title={path}
      aria-current={active ? "true" : undefined}
      data-active={active || undefined}
      className="side-row gap-2 px-2.5 text-left"
    >
      <span className="shrink-0 truncate">{name}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted/70">
        {folder}
      </span>
      <span className="flex shrink-0 gap-1.5 font-mono text-[11px] tabular-nums">
        {added > 0 && <span className="text-mint/80">+{added}</span>}
        {removed > 0 && <span className="text-danger/70">−{removed}</span>}
      </span>
    </button>
  );
}
