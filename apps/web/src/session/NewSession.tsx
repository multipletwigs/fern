import { useAtomSet } from "@effect/atom-react";
import { Composer } from "@repo/ui/Composer";
import { Empty } from "@repo/ui/Empty";
import { Exit } from "effect";
import { useState } from "react";
import { newSessionAtom, selectedSessionAtom, startSessionAtom } from "./atoms";
import { outgoing, useCommands } from "./commands";

// A blank Session in a Project's folder, as /clear leaves it. Its first message starts the Session,
// which then takes over the screen.
export function NewSession({ root }: { root: string }) {
  const start = useAtomSet(startSessionAtom, { mode: "promiseExit" });
  const select = useAtomSet(selectedSessionAtom);
  const close = useAtomSet(newSessionAtom);
  const commands = useCommands(root);
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
        onSend={async (message) => {
          // Already blank.
          if (message.command === "clear") return true;
          const exit = await start({
            payload: { cwd: root, message: outgoing(message) },
          });
          if (Exit.isFailure(exit)) {
            setFailure("Couldn't start a session. Try again.");
            return false;
          }
          select(exit.value.id);
          close(undefined);
          return true;
        }}
        onStop={() => {}}
      />
    </div>
  );
}
