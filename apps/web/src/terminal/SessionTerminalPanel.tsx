import { useAtom } from "@effect/atom-react";
import { TerminalPanel } from "@repo/ui/TerminalPanel";
import { useEffect, useState } from "react";
import {
  clampTerminalHeight,
  isTerminalToggle,
  terminalHeightAtom,
  terminalOpenAtom,
} from "./atoms";
import { SessionTerminal } from "./SessionTerminal";

// The terminal along the bottom of a Session's screen, shown and hidden with Ctrl+` or the button
// in its top bar, and dragged taller or shorter by its top edge. Once opened it stays mounted while
// hidden, so its shell's output keeps arriving.
export function SessionTerminalPanel({
  sessionId,
  root,
}: {
  sessionId: string;
  root: string;
}) {
  const [open, setOpen] = useAtom(terminalOpenAtom(sessionId));
  const [height, setHeight] = useAtom(terminalHeightAtom(sessionId));
  const [opened, setOpened] = useState<string>();
  // How many times its shell has been restarted: each restart mounts a fresh xterm.
  const [restarts, setRestarts] = useState(0);
  if (open && opened !== sessionId) setOpened(sessionId);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isTerminalToggle(event)) return;
      event.preventDefault();
      setOpen((shown) => !shown);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  if (opened !== sessionId) return null;
  return (
    <TerminalPanel
      hidden={!open}
      height={clampTerminalHeight(height, window.innerHeight)}
      onHeightChange={(next) =>
        setHeight(clampTerminalHeight(next, window.innerHeight))
      }
    >
      <SessionTerminal
        key={`${sessionId}\0${root}\0${restarts}`}
        sessionId={sessionId}
        root={root}
        visible={open}
        onRestarted={() => setRestarts((n) => n + 1)}
      />
    </TerminalPanel>
  );
}
