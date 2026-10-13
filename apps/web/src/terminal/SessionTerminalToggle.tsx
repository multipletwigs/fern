import { useAtom } from "@effect/atom-react";
import { TerminalToggle } from "@repo/ui/TerminalToggle";
import { terminalOpenAtom } from "./atoms";

// In a Session's top bar, the button that shows and hides its terminal.
export function SessionTerminalToggle({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useAtom(terminalOpenAtom(sessionId));
  return <TerminalToggle open={open} onToggle={() => setOpen(!open)} />;
}
