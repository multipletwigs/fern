import { ArchiveIcon } from "@phosphor-icons/react";

// A box icon that archives something; `name` says what, for its label.
export function ArchiveButton({
  name,
  disabled,
  onClick,
}: {
  name: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={`Archive ${name}`}
      aria-label={`Archive ${name}`}
      disabled={disabled}
      onClick={onClick}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/[0.06] hover:text-ink disabled:pointer-events-none disabled:opacity-40"
    >
      <ArchiveIcon className="size-3.5" />
    </button>
  );
}
