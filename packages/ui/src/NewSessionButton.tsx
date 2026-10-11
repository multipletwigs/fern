import { PlusIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";

// A plus that opens a blank Session in a Project's folder; `name` is the Project's.
export function NewSessionButton({
  name,
  className,
  onClick,
}: {
  name: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={`New session in ${name}`}
      aria-label={`New session in ${name}`}
      onClick={onClick}
      className={clsx(
        "flex shrink-0 items-center justify-center text-muted transition-colors hover:bg-white/[0.06] hover:text-ink",
        className,
      )}
    >
      <PlusIcon weight="bold" className="size-3.5" />
    </button>
  );
}
