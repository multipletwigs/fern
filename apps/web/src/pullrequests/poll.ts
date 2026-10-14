// Calls `refresh` every `every` milliseconds while the page is visible, and never while it's
// hidden. Shown again after a full interval out of sight, it refreshes at once, then keeps the
// beat from there. What's visible, and when that changes, come from the caller: the document's
// visibility, in the app. Returns what stops it.
export function startPolling({
  every,
  refresh,
  visible,
  onVisibilityChange,
}: {
  readonly every: number;
  readonly refresh: () => void;
  readonly visible: () => boolean;
  readonly onVisibilityChange: (listener: () => void) => () => void;
}): () => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  // When the list was last fetched, or polling started.
  let last = Date.now();
  const tick = () => {
    last = Date.now();
    refresh();
  };
  const start = (delay: number) => {
    timeout = setTimeout(() => {
      tick();
      interval = setInterval(tick, every);
    }, delay);
  };
  const halt = () => {
    clearTimeout(timeout);
    clearInterval(interval);
  };
  const changed = () => {
    halt();
    if (!visible()) return;
    const since = Date.now() - last;
    if (since < every) return start(every - since);
    tick();
    start(every);
  };
  if (visible()) start(every);
  const unlisten = onVisibilityChange(changed);
  return () => {
    halt();
    unlisten();
  };
}
