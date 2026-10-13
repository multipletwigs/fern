import { Menu } from "@base-ui/react/menu";
import { CaretDownIcon } from "@phosphor-icons/react";
import type { SubagentStatus } from "@repo/api";
import { AgentsMenuItem } from "./AgentsMenuItem";

// A Session's Subagents behind one quiet "Agents" button in its tab bar, so they never crowd it.
// The button counts them, with a pulsing dot while any still works. Its menu lists each in start
// order; picking one shows its tab, and each can be closed from its row. Arrow keys move through
// the rows and Escape closes the menu.
export function AgentsMenu<Value extends string>({
  agents,
  running,
  value,
  onChange,
  onClose,
}: {
  agents: ReadonlyArray<{
    value: Value;
    description: string;
    agentType: string;
    status: SubagentStatus;
  }>;
  // How many of them are still working.
  running: number;
  // The tab showing, which may be one of theirs.
  value: string;
  onChange: (value: Value) => void;
  onClose: (value: Value) => void;
}) {
  if (agents.length === 0) return null;
  const summary = `${agents.length} ${agents.length === 1 ? "Subagent" : "Subagents"}${running > 0 ? `, ${running} still working` : ""}`;
  return (
    <Menu.Root>
      <Menu.Trigger
        title={summary}
        aria-label={`Agents: ${summary}`}
        className="group flex h-7 shrink-0 items-center gap-1.5 rounded-md pr-2 pl-2.5 text-[12px] whitespace-nowrap text-muted transition-[color,background-color,scale] duration-150 ease-out hover:text-ink active:scale-[0.97] data-popup-open:bg-white/[0.06] data-popup-open:text-ink"
      >
        Agents
        <span className="text-faint tabular-nums transition-colors group-hover:text-muted group-data-popup-open:text-muted">
          {agents.length}
        </span>
        {running > 0 && (
          <span className="size-1 rounded-full bg-ink/60 motion-safe:animate-pulse" />
        )}
        <CaretDownIcon
          className="size-2.5 text-faint transition-transform duration-150 ease-out group-data-popup-open:rotate-180"
          weight="bold"
        />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-50"
        >
          <Menu.Popup className="max-h-[min(var(--available-height),28rem)] w-80 max-w-(--available-width) origin-(--transform-origin) overflow-y-auto rounded-xl bg-[#141414] p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.5),0_12px_32px_rgb(0_0_0/0.55),inset_0_1px_0_rgb(255_255_255/0.08)] outline-none transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:duration-100 data-starting-style:scale-[0.97] data-starting-style:opacity-0">
            {agents.map((agent) => (
              <AgentsMenuItem
                key={agent.value}
                description={agent.description}
                agentType={agent.agentType}
                status={agent.status}
                selected={agent.value === value}
                onSelect={() => onChange(agent.value)}
                onClose={() => onClose(agent.value)}
              />
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
