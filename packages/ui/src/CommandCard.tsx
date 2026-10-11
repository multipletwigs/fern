export function CommandCard({ name, args }: { name: string; args: string }) {
  return (
    <div className="mt-10 mb-6 flex items-baseline gap-3 rounded-2xl border border-hairline bg-white/[0.035] px-5 py-4">
      <span className="shrink-0 font-mono text-sm whitespace-nowrap text-ice">
        {name}
      </span>
      <span className="truncate text-sm text-muted">{args}</span>
    </div>
  );
}
