import { Tooltip } from "@base-ui/react/tooltip";
import type { ReactNode } from "react";

// The surface a tooltip shows on: a raised panel whose bezel catches light along the top edge and
// fades out toward the bottom, with a triangle pointing at what it describes. Goes inside a
// Tooltip.Root, after its Trigger.
export function TooltipPanel({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Portal>
      <Tooltip.Positioner side="top" sideOffset={10} className="z-50">
        <Tooltip.Popup className="relative origin-(--transform-origin) rounded-xl bg-[#141414] p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.5),0_12px_32px_rgb(0_0_0/0.55),inset_0_1px_0_rgb(255_255_255/0.08)] transition-[opacity,scale] duration-150 ease-out before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-linear-to-b before:from-white/15 before:to-white/0 before:p-px before:[mask:linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)] data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 data-instant:transition-none">
          {children}
          <Tooltip.Arrow className="data-[side=bottom]:-top-[7px] data-[side=bottom]:rotate-180 data-[side=top]:-bottom-[7px]">
            <svg width="14" height="7" viewBox="0 0 14 7" className="block">
              <path d="M0 0H14L8.2 5.8Q7 7 5.8 5.8Z" fill="#141414" />
            </svg>
          </Tooltip.Arrow>
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  );
}
