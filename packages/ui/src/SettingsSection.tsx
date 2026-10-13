import type { ReactNode } from "react";

// One section of Settings: its title and what it's about, an optional action beside them, and its
// rows.
export function SettingsSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  // The section's rows, each an `<li>`, or what stands in for them.
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="mt-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[15px] text-ink">{title}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{description}</p>
        </div>
        {action}
      </div>
      <ul className="mt-4 divide-y divide-hairline border-t border-hairline">
        {children}
      </ul>
    </section>
  );
}
