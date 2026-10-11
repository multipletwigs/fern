import { MessageCard } from "./MessageCard";

// A slash command the developer ran, as their turn in the transcript: the command in pixel type,
// then its arguments.
export function CommandCard({ name, args }: { name: string; args: string }) {
  return (
    <MessageCard>
      <span className="rounded bg-white/10 px-1.5 py-0.5 font-pixel text-[13px] text-ink">
        {name}
      </span>
      {args && <span className="ml-2 text-muted">{args}</span>}
    </MessageCard>
  );
}
