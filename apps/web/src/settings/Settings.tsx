import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { SettingsPanel } from "@repo/ui/SettingsPanel";
import { ToolStatusRow } from "@repo/ui/ToolStatusRow";
import { AsyncResult } from "effect/reactivity";
import { settingsOpenAtom } from "../workspace/showing";
import { toolsAtom } from "./atoms";
import { TOOL_NAMES } from "./toolNames";

// Settings, in place of the Session: where each of the developer's tools stands, checked again on
// Re-check.
export function Settings() {
  const tools = useAtomValue(toolsAtom);
  const recheck = useAtomRefresh(toolsAtom);
  const setOpen = useAtomSet(settingsOpenAtom);
  const checking = AsyncResult.isInitial(tools) || tools.waiting;

  return (
    <SettingsPanel
      onBack={() => setOpen(false)}
      onRecheck={recheck}
      checking={checking}
    >
      {AsyncResult.isSuccess(tools) ? (
        tools.value.map((status) => (
          <ToolStatusRow
            key={status.tool}
            name={TOOL_NAMES[status.tool]}
            command={status.tool}
            state={status.state}
            version={status.version}
            account={status.account}
            detail={status.detail}
            fix={status.fix}
          />
        ))
      ) : (
        <li className="py-4 text-[13px] text-muted">
          {AsyncResult.isFailure(tools)
            ? "Couldn't ask Fern's server about your tools."
            : "Checking your tools…"}
        </li>
      )}
    </SettingsPanel>
  );
}
