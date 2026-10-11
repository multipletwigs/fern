export function TranscriptTitle({
  meta,
  title,
}: {
  meta: string;
  title: string;
}) {
  return (
    <div className="mx-auto w-full max-w-[720px] px-6 pt-10 pb-12">
      <p className="font-mono text-xs text-faint">{meta}</p>
      <h1 className="mt-3 text-[28px] leading-tight font-medium tracking-tight text-balance">
        {title}
      </h1>
    </div>
  );
}
