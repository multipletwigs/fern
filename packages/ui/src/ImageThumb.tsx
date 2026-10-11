import { XIcon } from "@phosphor-icons/react";
import { Tooltip } from "@base-ui/react/tooltip";
import { TooltipPanel } from "./TooltipPanel";

// A small square preview of an image, with a remove button when it can still be taken back.
// Resting the pointer on it shows the whole image larger.
export function ImageThumb({
  url,
  onRemove,
}: {
  url: string;
  onRemove?: () => void;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        delay={500}
        render={
          <div className="group relative size-16 shrink-0 overflow-hidden rounded-lg border border-hairline bg-white/[0.04]" />
        }
      >
        <img src={url} alt="" className="size-full object-cover" />
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove image"
            className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/70 text-ink opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <XIcon weight="bold" className="size-3" />
          </button>
        )}
      </Tooltip.Trigger>
      <TooltipPanel>
        <img
          src={url}
          alt=""
          className="block max-h-80 max-w-80 rounded-lg object-contain"
        />
      </TooltipPanel>
    </Tooltip.Root>
  );
}
