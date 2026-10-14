import { useAtom } from "@effect/atom-react";
import type { TerminalTarget } from "@repo/api";
import { TerminalPanel } from "@repo/ui/TerminalPanel";
import { useEffect, useState } from "react";
import {
  clampTerminalHeight,
  isTerminalToggle,
  terminalHeightAtom,
  terminalKeyOf,
  terminalOpenAtom,
} from "./atoms";
import { ShellTerminal } from "./ShellTerminal";

// The terminal along the bottom of a screen, a Session's or a Foreign PR's on the Pull requests
// page, shown and hidden with Ctrl+` or the button in its top bar, and dragged taller or shorter by
// its top edge. Once opened it stays mounted while hidden, so its shell's output keeps arriving.
export function TerminalDock({
  target,
  folder,
}: {
  target: TerminalTarget;
  // Where the shell runs, as the page knows it: a new folder means a fresh shell there.
  folder: string;
}) {
  const key = terminalKeyOf(target);
  const [open, setOpen] = useAtom(terminalOpenAtom(key));
  const [height, setHeight] = useAtom(terminalHeightAtom(key));
  const [opened, setOpened] = useState<string>();
  // How many times its shell has been restarted: each restart mounts a fresh xterm.
  const [restarts, setRestarts] = useState(0);
  if (open && opened !== key) setOpened(key);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isTerminalToggle(event)) return;
      event.preventDefault();
      setOpen((shown) => !shown);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  if (opened !== key) return null;
  return (
    <TerminalPanel
      hidden={!open}
      height={clampTerminalHeight(height, window.innerHeight)}
      onHeightChange={(next) =>
        setHeight(clampTerminalHeight(next, window.innerHeight))
      }
    >
      {/* A new folder, as when the Session moves into a worktree, means a fresh shell there. */}
      <ShellTerminal
        key={`${key}\0${folder}\0${restarts}`}
        target={target}
        visible={open}
        onRestarted={() => setRestarts((n) => n + 1)}
      />
    </TerminalPanel>
  );
}
