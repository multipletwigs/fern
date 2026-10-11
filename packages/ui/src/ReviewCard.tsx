import { clsx } from "clsx";
import type { ReactNode } from "react";

// One thing the developer reviews: a Section or an Unexplained change, with its verdict controls
// at the foot. Settled cards recede so the open ones stand out.
export function ReviewCard({
  eyebrow,
  title,
  settled,
  children,
  footer,
}: {
  eyebrow: string;
  title?: string;
  settled: boolean;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <section
      className={clsx(
        "rounded-2xl border p-5 transition-colors",
        settled ? "border-hairline" : "border-white/[0.12] bg-white/[0.015]",
      )}
    >
      <p className="font-mono text-[11px] tracking-wide text-faint uppercase">
        {eyebrow}
      </p>
      {title && <h3 className="mt-1.5 text-lg leading-7 text-ink">{title}</h3>}
      <div className="mt-3 space-y-3">{children}</div>
      <div className="mt-5 border-t border-hairline pt-4">{footer}</div>
    </section>
  );
}
