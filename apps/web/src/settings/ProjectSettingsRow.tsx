import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { ProjectStacksRow } from "@repo/ui/ProjectStacksRow";
import { Exit } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import {
  projectSettingsAtom,
  projectSettingsKey,
  saveProjectSettingsAtom,
} from "./atoms";

const projectName = (path: string) => path.split("/").at(-1) || path;

// One Project in Settings: whether its Hosted Sessions land as a GitHub Stack, switched on the
// server.
export function ProjectSettingsRow({ root }: { root: string }) {
  const settings = useAtomValue(projectSettingsAtom(root));
  const save = useAtomSet(saveProjectSettingsAtom, { mode: "promiseExit" });
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const change = async (stacks: boolean) => {
    setSaving(true);
    setFailed(false);
    const exit = await save({
      payload: { root, stacks },
      reactivityKeys: [projectSettingsKey(root)],
    });
    setSaving(false);
    setFailed(Exit.isFailure(exit));
  };

  return (
    <ProjectStacksRow
      name={projectName(root)}
      path={root}
      stacks={
        AsyncResult.isSuccess(settings) ? settings.value.stacks : undefined
      }
      saving={saving}
      failed={
        failed
          ? "Couldn't save that. Try again."
          : AsyncResult.isFailure(settings)
            ? "Couldn't read this Project's settings."
            : undefined
      }
      onChange={(stacks) => void change(stacks)}
    />
  );
}
