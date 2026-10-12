import type { ReactNode } from "react";

// A titled group of DetailRows, as in the context meter's tooltip.
export function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-0.5">
      <h3 className="px-1.5 pb-0.5 text-[10px] font-medium tracking-wider text-faint uppercase">
        {title}
      </h3>
      <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-0.5">
        {children}
      </dl>
    </section>
  );
}
