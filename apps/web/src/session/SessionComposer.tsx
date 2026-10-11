import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { isInUseElsewhere, type SessionHeader } from "@repo/api";
import { Composer } from "@repo/ui/Composer";
import { QueuedMessages } from "@repo/ui/QueuedMessages";
import { Cause, DateTime, Exit, Option } from "effect";
import { useState } from "react";
import {
  interruptAtom,
  modelChoiceAtom,
  newSessionAtom,
  pendingPromptAtom,
  sendMessageAtom,
  unqueueAtom,
} from "./atoms";
import { outgoing, useCommands } from "./commands";
import { SessionTools } from "./SessionTools";

const failureNotice = (tag: string | undefined) => {
  switch (tag) {
    case "SessionBusy":
      return "Claude is already working on this Session.";
    case "SessionInUse":
      return "This Session is running somewhere else right now.";
    case "SessionNotFound":
      return "This Session no longer exists.";
    default:
      return "Couldn't send that. Try again.";
  }
};

// Continues the open Session from Fern: sends become turns Fern runs, unless another process,
// such as Claude Code in a terminal, is writing the Session. /clear opens a new Session instead.
export function SessionComposer({
  header,
  now,
  lastTurnId,
}: {
  header: SessionHeader;
  now: number;
  // The transcript's latest developer turn, which a sent message will follow.
  lastTurnId: string | undefined;
}) {
  const send = useAtomSet(sendMessageAtom, { mode: "promiseExit" });
  const interrupt = useAtomSet(interruptAtom);
  const unqueue = useAtomSet(unqueueAtom);
  const openNew = useAtomSet(newSessionAtom);
  const setPending = useAtomSet(pendingPromptAtom(header.id));
  const commands = useCommands(header.cwd);
  const model = useAtomValue(modelChoiceAtom(header.id));
  const [failure, setFailure] = useState<string>();

  const turn = header.hostedTurn;
  const queued = turn?.queued ?? [];
  const inUse = isInUseElsewhere(
    DateTime.toEpochMillis(header.lastActivityAt),
    turn,
    now,
  );

  return (
    <Composer
      placeholder={inUse ? "Running in a terminal…" : "Message Claude Code"}
      disabled={inUse}
      running={turn?.running ?? false}
      notice={
        inUse
          ? "Running in a terminal. You can continue it here once it goes idle."
          : (failure ?? (turn?.running ? undefined : turn?.error))
      }
      commands={commands}
      tools={<SessionTools header={header} disabled={inUse} />}
      queue={
        <QueuedMessages
          items={queued}
          onRemove={(item) => unqueue({ params: { id: header.id, item } })}
        />
      }
      onSend={async (message) => {
        if (message.command === "clear") {
          if (header.cwd) openNew(header.cwd);
          else setFailure("This Session has no folder to start a new one in.");
          return header.cwd !== undefined;
        }
        const payload = outgoing(message, model);
        // Behind a running turn the message queues, and shows in the queue rather than the
        // transcript.
        if (turn?.running) {
          const exit = await send({ params: { id: header.id }, payload });
          if (Exit.isSuccess(exit)) return true;
          const error = Cause.findErrorOption(exit.cause);
          setFailure(failureNotice(Option.getOrUndefined(error)?._tag));
          return false;
        }
        // Shown straight away, so the message rises to the top before Claude Code records it.
        setPending({
          id: crypto.randomUUID(),
          sentAt: Date.now(),
          command: message.command,
          text: message.text,
          images: message.images.map((image) => image.url),
          after: lastTurnId,
        });
        const exit = await send({ params: { id: header.id }, payload });
        if (Exit.isFailure(exit)) setPending(undefined);
        if (Exit.isSuccess(exit)) {
          setFailure(undefined);
          return true;
        }
        const error = Cause.findErrorOption(exit.cause);
        setFailure(failureNotice(Option.getOrUndefined(error)?._tag));
        return false;
      }}
      onStop={() => {
        interrupt({ params: { id: header.id } });
        // Stopping drops the queue; what it said goes back in the box. Its images don't.
        return queued.map((item) => item.text).join("\n\n") || undefined;
      }}
    />
  );
}
