import type { ReactNode } from "react";

// The open item of the Review tab, filling the right: where it sits, what it is, its explanation
// and diff, and its verdict pinned to the foot, so a long diff scrolls under it. A `badge`, such
// as a Section's Risk, sits beside the title.
export function ReviewPane({
  eyebrow,
  title,
  badge,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-[860px] flex-1 px-10 pt-10 pb-8">
        <p className="font-mono text-[11px] tracking-wide text-amber/80 uppercase">
          {eyebrow}
        </p>
        <div className="mt-2 flex items-start gap-3">
          <h2 className="min-w-0 flex-1 text-[24px] leading-8 font-medium text-balance text-ink">
            {title}
          </h2>
          {badge && <div className="mt-1 shrink-0">{badge}</div>}
        </div>
        <div className="mt-4 space-y-4 text-[14px] leading-6 text-ink/80">
          {children}
        </div>
      </div>
      {footer && (
        <div className="sticky bottom-0 border-t border-hairline bg-panel/95 backdrop-blur-sm">
          <div className="mx-auto w-full max-w-[860px] px-10 py-4">
            {footer}
          </div>
        </div>
      )}
    </div>
  );
}
