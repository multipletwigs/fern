import { AlertDialog } from "@base-ui/react/alert-dialog";
import { GhostButton } from "./GhostButton";

// Asks the developer before something that can't be undone. Cancelling, Esc, or clicking outside
// closes it; only the confirm button calls `onConfirm`.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-black/50 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-[#141414] p-5 shadow-[0_1px_2px_rgb(0_0_0/0.5),0_12px_32px_rgb(0_0_0/0.55),inset_0_1px_0_rgb(255_255_255/0.08)] transition-[opacity,scale] duration-150 ease-out outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <AlertDialog.Title className="text-sm font-medium text-ink">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[13px] leading-relaxed text-muted">
            {description}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <GhostButton onClick={() => onOpenChange(false)}>
              Cancel
            </GhostButton>
            <GhostButton tone="danger" disabled={pending} onClick={onConfirm}>
              {confirmLabel}
            </GhostButton>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
