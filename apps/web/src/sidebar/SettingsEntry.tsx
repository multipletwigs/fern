import { useAtom, useAtomValue } from "@effect/atom-react";
import { SettingsRow } from "@repo/ui/SettingsRow";
import { AsyncResult } from "effect/reactivity";
import { settingsOpenAtom, toolsAtom } from "../settings/atoms";
import { needsAttention } from "../settings/needsAttention";

// The Settings row at the foot of the sidebar, flagged while any tool isn't ready.
export function SettingsEntry() {
  const [open, setOpen] = useAtom(settingsOpenAtom);
  const tools = useAtomValue(toolsAtom);
  return (
    <SettingsRow
      active={open}
      attention={AsyncResult.isSuccess(tools) && needsAttention(tools.value)}
      onSelect={() => setOpen(true)}
    />
  );
}
