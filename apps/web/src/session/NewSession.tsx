import { RegistryContext, useAtomSet } from "@effect/atom-react";
import { Composer } from "@repo/ui/Composer";
import { Empty } from "@repo/ui/Empty";
import { ModelPicker } from "@repo/ui/ModelPicker";
import { Cause, Exit, Option } from "effect";
import { useContext, useState } from "react";
import {
  modelChoiceAtom,
  selectedSessionAtom,
  startSessionAtom,
} from "./atoms";
import { outgoing, useCommands } from "./commands";
import { currentModel, MODELS, NEW_SESSION_MODEL } from "./models";
import { newSessionAtom } from "../workspace/showing";

// A new Session in a Project. Its opening message starts it on a branch of its own from `main`, in
// its own worktree, as a chat: the Flow starts with a Grill when the developer says so, or right
// away when the message is the Grill's command. The Session then takes over the screen.
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
        placeholder="Ask about this Project, or describe what to build"
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
            payload: { root, message: outgoing(message, model) },
          });
          if (Exit.isFailure(exit)) {
            const error = Option.getOrUndefined(
              Cause.findErrorOption(exit.cause),
            );
            setFailure(
              error?._tag === "WorktreeError"
                ? `Couldn't make a worktree: ${error.message}`
                : "Couldn't start a session. Try again.",
            );
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
