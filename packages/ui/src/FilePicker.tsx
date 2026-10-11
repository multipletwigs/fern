import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";

const MAX_RESULTS = 80;

// Whether every character of the query appears in the path, in order.
const matches = (path: string, query: string) => {
  let at = 0;
  for (const char of path.toLowerCase()) if (char === query[at]) at++;
  return at === query.length;
};

// Paths whose file name contains the query come first, then shorter paths.
const rank = (path: string, query: string) =>
  (path.toLowerCase().split("/").at(-1)?.includes(query) ? 0 : 1000) +
  path.length;

// A ⌘P-style file finder: a button showing the open file that expands into a filtered list.
export function FilePicker({
  files,
  current,
  onPick,
}: {
  files: ReadonlyArray<string>;
  current: string | undefined;
  onPick: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "p" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files.slice(0, MAX_RESULTS);
    return files
      .filter((path) => matches(path, q))
      .toSorted((a, b) => rank(a, q) - rank(b, q))
      .slice(0, MAX_RESULTS);
  }, [files, query]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setHighlighted(0);
  };

  const pick = (path: string | undefined) => {
    if (path) onPick(path);
    close();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") close();
    else if (event.key === "Enter") pick(results[highlighted]);
    else if (event.key === "ArrowDown")
      setHighlighted((i) => Math.min(i + 1, results.length - 1));
    else if (event.key === "ArrowUp") setHighlighted((i) => Math.max(i - 1, 0));
    else return;
    event.preventDefault();
  };

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Open file (⌘P)"
        className="flex h-7 max-w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-[13px] text-ink/85 transition-colors hover:bg-white/[0.05]"
      >
        <MagnifyingGlassIcon className="size-3.5 shrink-0 text-muted" />
        <span className="truncate font-mono text-xs">
          {current ?? "Open file…"}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-faint">⌘P</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={close} aria-hidden />
          <div className="absolute top-9 left-0 z-30 w-[520px] max-w-[70vw] overflow-hidden rounded-xl border border-white/10 bg-[#111] shadow-[0_16px_50px_rgb(0_0_0/0.6)]">
            <input
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the finder exists to be typed into
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlighted(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search files"
              className="w-full border-b border-hairline bg-transparent px-3.5 py-2.5 text-[13px] text-ink outline-none placeholder:text-faint"
            />
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((path, index) => (
                <li key={path}>
                  <button
                    type="button"
                    onClick={() => pick(path)}
                    onMouseEnter={() => setHighlighted(index)}
                    className={clsx(
                      "flex w-full items-baseline gap-2 px-3.5 py-1.5 text-left font-mono text-xs",
                      index === highlighted
                        ? "bg-white/[0.07] text-ink"
                        : "text-ink/70",
                    )}
                  >
                    <span className="shrink-0">{path.split("/").at(-1)}</span>
                    <span className="truncate text-faint">{path}</span>
                  </button>
                </li>
              ))}
              {results.length === 0 && (
                <li className="px-3.5 py-2 text-xs text-faint">No matches</li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
