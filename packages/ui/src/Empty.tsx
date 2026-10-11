// A full-height placeholder message; doubles as a window drag region.
export function Empty({ text }: { text: string }) {
  return (
    <div className="drag flex h-full items-center justify-center text-sm text-muted">
      {text}
    </div>
  );
}
