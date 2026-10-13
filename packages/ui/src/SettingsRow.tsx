import { GearSixIcon } from "@phosphor-icons/react";

// The sidebar's Settings entry, at its foot. A warning mark shows while something there needs the
// developer, such as a tool that isn't ready.
export function SettingsRow({
  active,
  attention,
  onSelect,
}: {
  active: boolean;
  attention: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-active={active || undefined}
      aria-current={active ? "page" : undefined}
      className="side-row gap-2.5 px-2.5 text-left"
    >
      <GearSixIcon className="size-4 shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate">Settings</span>
      {attention && (
        <span
          role="status"
          aria-label="A tool needs attention"
          title="A tool needs attention"
          className="size-1.5 shrink-0 rounded-full bg-amber"
        />
      )}
    </button>
  );
}
