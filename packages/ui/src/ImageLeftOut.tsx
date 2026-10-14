// An image in Markdown that isn't loaded, as one from text someone else could write would tell
// their server who read it, and when: its alt text and where it would have come from, as text.
export function ImageLeftOut({ alt, src }: { alt?: string; src?: unknown }) {
  return (
    <span
      title={typeof src === "string" ? src : undefined}
      className="rounded border border-hairline px-1.5 py-px text-[13px] text-muted"
    >
      Image not loaded{alt ? `: ${alt}` : ""}
    </span>
  );
}
