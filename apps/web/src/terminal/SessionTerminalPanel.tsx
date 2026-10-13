import { useAtom } from "@effect/atom-react";
import { TerminalPanel } from "@repo/ui/TerminalPanel";
import { useEffect, useState } from "react";
import { isTerminalToggle, terminalOpenAtom } from "./atoms";
import { SessionTerminal } from "./SessionTerminal";

const HEIGHT = 280;

// The terminal along the bottom of a Session's screen, shown and hidden with Ctrl+` or the button
// in its top bar. Once opened it stays mounted while hidden, so its shell's output keeps arriving.
export function SessionTerminalPanel({
  sessionId,
  root,
}: {
  sessionId: string;
  root: string;
}) {
  const [open, setOpen] = useAtom(terminalOpenAtom(sessionId));
  const [opened, setOpened] = useState<string>();
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
    <TerminalPanel hidden={!open} height={HEIGHT}>
      <SessionTerminal
        key={`${sessionId}\0${root}`}
        sessionId={sessionId}
        root={root}
        visible={open}
      />
    </TerminalPanel>
  );
}
