import { Tooltip } from "@base-ui/react/tooltip";
import { WarningDiamondIcon } from "@phosphor-icons/react";
import { TooltipPanel } from "./TooltipPanel";

// Marks a Section that cites no Decision: the agent changed something the developer never agreed
// to, so it deserves their attention.
export function UnplannedChip() {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        delay={150}
        render={
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-amber/30 bg-amber/[0.08] px-2.5 text-[12px] font-medium text-amber" />
        }
      >
        <WarningDiamondIcon weight="fill" className="size-3.5" />
        Unplanned
      </Tooltip.Trigger>
      <TooltipPanel>
        <p className="max-w-72 px-1.5 py-0.5 text-[12px] leading-5 text-ink">
          Cites no Decision: nothing you settled asked for this change.
        </p>
      </TooltipPanel>
    </Tooltip.Root>
  );
}
