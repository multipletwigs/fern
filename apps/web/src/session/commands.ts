import { useAtomValue } from "@effect/atom-react";
import type { OutgoingMessage } from "@repo/api";
import type { ComposerCommand, ComposerImage } from "@repo/ui/Composer";
import { Atom, AsyncResult } from "effect/reactivity";
import { useMemo } from "react";
import { commandsAtom } from "./atoms";

// Fern runs /clear itself: it opens a blank Session in the same Project, as Claude Code does.
const clear: ComposerCommand = {
  name: "clear",
  description: "Start a new session in this project",
  argumentHint: "",
};

const none = Atom.make(AsyncResult.success<ReadonlyArray<ComposerCommand>>([]));

// The slash commands to offer in the composer for a Project's folder.
export const useCommands = (root: string | undefined) => {
  const result = useAtomValue(root ? commandsAtom(root) : none);
  return useMemo(
    () => [
      clear,
      ...(AsyncResult.isSuccess(result) ? result.value : []).filter(
        (command) => command.name !== clear.name,
      ),
    ],
    [result],
  );
};

// What the composer hands over, as the server takes it. A slash command goes to Claude Code as
// typed, followed by its arguments.
export const outgoing = ({
  text,
  images,
  command,
}: {
  text: string;
  images: ReadonlyArray<ComposerImage>;
  command?: string;
}): OutgoingMessage => ({
  text: command ? [`/${command}`, text].filter(Boolean).join(" ") : text,
  images: images.map(({ mediaType, data }) => ({ mediaType, data })),
});
