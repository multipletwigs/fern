import { Collapsible } from "@base-ui/react/collapsible";
import { CaretRightIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

export function Expandable({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible.Root className="my-1.5">
      <Collapsible.Trigger className="group flex w-full items-center gap-2.5 text-left text-sm text-muted hover:text-ink">
        {label}
        <CaretRightIcon
          weight="bold"
          className="size-3 shrink-0 text-faint transition-transform group-data-[panel-open]:rotate-90"
        />
      </Collapsible.Trigger>
      <Collapsible.Panel className="mt-2 mb-4 ml-4 border-l border-hairline pl-4">
        {children}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
