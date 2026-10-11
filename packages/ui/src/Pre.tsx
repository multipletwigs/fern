import { clsx } from "clsx";

export function Pre({ text, className }: { text: string; className?: string }) {
  return (
    <pre
      className={clsx(
        "my-2 max-h-80 overflow-auto rounded-xl bg-white/[0.025] p-3 font-mono text-xs leading-5 whitespace-pre-wrap text-muted",
        className,
      )}
    >
      {text}
    </pre>
  );
}
