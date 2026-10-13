import { useAtom } from "@effect/atom-react";
import { CodeToggle } from "@repo/ui/CodeToggle";
import { codePanelOpenAtom } from "./panel";

// In a Session's top bar, the button that shows and hides the code panel, beside the terminal's.
export function SessionCodeToggle({ changed }: { changed: number }) {
  const [open, setOpen] = useAtom(codePanelOpenAtom);
  return (
    <CodeToggle open={open} changed={changed} onToggle={() => setOpen(!open)} />
  );
}
