import { Collapsible } from "@base-ui/react/collapsible";
import { CaretRightIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

// A collapsible run of file rows under a small heading with its count; closed until clicked.
export function FileGroup({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <Collapsible.Root className="mt-2">
      <Collapsible.Trigger className="group flex h-7 w-full items-center gap-1.5 rounded-lg px-2.5 text-left text-xs text-faint transition-colors hover:text-muted">
        <CaretRightIcon
          weight="bold"
          className="size-3 shrink-0 transition-transform group-data-[panel-open]:rotate-90"
        />
        {label}
        <span className="font-mono text-[11px] tabular-nums">{count}</span>
      </Collapsible.Trigger>
      <Collapsible.Panel className="space-y-px">{children}</Collapsible.Panel>
    </Collapsible.Root>
  );
}
