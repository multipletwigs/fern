import { GhostButton } from "./GhostButton";

// What a filtered list says in place of its rows when none show, with a way back to some when
// there is one.
export function ListEmpty({
  text,
  action,
  onAction,
}: {
  text: string;
  // What the button reads, as "Clear filters", when there's one.
  action?: string | undefined;
  onAction?: (() => void) | undefined;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-hairline px-4 py-5">
      <p className="text-[13px] text-muted">{text}</p>
      {action !== undefined && onAction !== undefined && (
        <GhostButton onClick={onAction}>{action}</GhostButton>
      )}
    </div>
  );
}
