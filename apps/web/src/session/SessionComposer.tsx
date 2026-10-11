import { useAtomSet } from "@effect/atom-react";
import { isInUseElsewhere, type SessionHeader } from "@repo/api";
import { Composer } from "@repo/ui/Composer";
import { Cause, DateTime, Exit, Option } from "effect";
import { useState } from "react";
import { interruptAtom, sendMessageAtom } from "./atoms";

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
// such as Claude Code in a terminal, is writing the Session.
export function SessionComposer({
  header,
  now,
}: {
  header: SessionHeader;
  now: number;
}) {
  const send = useAtomSet(sendMessageAtom, { mode: "promiseExit" });
  const interrupt = useAtomSet(interruptAtom);
  const [failure, setFailure] = useState<string>();

  const turn = header.hostedTurn;
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
      onSend={async (text) => {
        const exit = await send({
          params: { id: header.id },
          payload: { text },
        });
        if (Exit.isSuccess(exit)) {
          setFailure(undefined);
          return true;
        }
        const error = Cause.findErrorOption(exit.cause);
        setFailure(failureNotice(Option.getOrUndefined(error)?._tag));
        return false;
      }}
      onStop={() => interrupt({ params: { id: header.id } })}
    />
  );
}
