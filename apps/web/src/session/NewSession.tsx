import { RegistryContext, useAtomSet } from "@effect/atom-react";
import { Composer } from "@repo/ui/Composer";
import { Empty } from "@repo/ui/Empty";
import { ModelPicker } from "@repo/ui/ModelPicker";
import { Exit } from "effect";
import { useContext, useState } from "react";
import {
  modelChoiceAtom,
  newSessionAtom,
  selectedSessionAtom,
  startSessionAtom,
} from "./atoms";
import { outgoing, useCommands } from "./commands";
import { currentModel, MODELS, NEW_SESSION_MODEL } from "./models";

// A blank Session in a Project's folder, as /clear leaves it. Its first message starts the Session,
// which then takes over the screen.
export function NewSession({ root }: { root: string }) {
  const start = useAtomSet(startSessionAtom, { mode: "promiseExit" });
  const select = useAtomSet(selectedSessionAtom);
  const close = useAtomSet(newSessionAtom);
  const commands = useCommands(root);
  const [model, setModel] = useState(NEW_SESSION_MODEL);
  const current = currentModel(model, undefined);
  const registry = useContext(RegistryContext);
  const [failure, setFailure] = useState<string>();

  return (
    <div className="flex h-full flex-col pt-12">
      <div className="flex-1">
        <Empty text={`New session in ${root.split("/").at(-1) ?? root}`} />
      </div>
      <Composer
        placeholder="Message Claude Code"
        running={false}
        notice={failure}
        commands={commands}
        tools={
          <ModelPicker
            models={MODELS}
            value={current.value}
            label={current.label}
            onChange={setModel}
          />
        }
        onSend={async (message) => {
          // Already blank.
          if (message.command === "clear") return true;
          const exit = await start({
            payload: { cwd: root, message: outgoing(message, model) },
          });
          if (Exit.isFailure(exit)) {
            setFailure("Couldn't start a session. Try again.");
            return false;
          }
          // The Session keeps the model it started on.
          registry.set(modelChoiceAtom(exit.value.id), model);
          select(exit.value.id);
          close(undefined);
          return true;
        }}
        onStop={() => {}}
      />
    </div>
  );
}
