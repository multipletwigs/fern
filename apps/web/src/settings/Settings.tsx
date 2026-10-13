import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { SettingsPanel } from "@repo/ui/SettingsPanel";
import { ToolStatusRow } from "@repo/ui/ToolStatusRow";
import { AsyncResult } from "effect/reactivity";
import { projectsAtom } from "../session/atoms";
import { settingsOpenAtom } from "../workspace/showing";
import { toolsAtom } from "./atoms";
import { ProjectSettingsRow } from "./ProjectSettingsRow";
import { TOOL_NAMES } from "./toolNames";

// Settings, in place of the Session: where each of the developer's tools stands, checked again on
// Re-check, and how each Project lands its Hosted Sessions' work.
export function Settings() {
  const tools = useAtomValue(toolsAtom);
  const projects = useAtomValue(projectsAtom);
  const recheck = useAtomRefresh(toolsAtom);
  const setOpen = useAtomSet(settingsOpenAtom);
  const checking = AsyncResult.isInitial(tools) || tools.waiting;

  return (
    <SettingsPanel
      onBack={() => setOpen(false)}
      onRecheck={recheck}
      checking={checking}
      projects={
        AsyncResult.isSuccess(projects) && projects.value.length > 0 ? (
          projects.value.map((project) => (
            <ProjectSettingsRow key={project.path} root={project.path} />
          ))
        ) : (
          <li className="py-4 text-[13px] text-muted">
            {AsyncResult.isSuccess(projects)
              ? "No Projects yet."
              : "Reading your Projects…"}
          </li>
        )
      }
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
