import { clsx } from "clsx";

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
      className={clsx(
        "flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] transition-colors",
        active
          ? "bg-white/[0.09] text-ink shadow-[0_1px_2px_rgb(0_0_0/0.5),inset_0_1px_0_rgb(255_255_255/0.06)]"
          : "text-ink/65 hover:bg-white/[0.04] hover:text-ink",
      )}
    >
      <span className="shrink-0 truncate">{name}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint">
        {folder}
      </span>
      <span className="flex shrink-0 gap-1.5 font-mono text-[11px] tabular-nums">
        {added > 0 && <span className="text-mint/80">+{added}</span>}
        {removed > 0 && <span className="text-danger/70">−{removed}</span>}
      </span>
    </button>
  );
}
