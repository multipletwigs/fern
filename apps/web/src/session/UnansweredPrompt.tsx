import { useAtomSet } from "@effect/atom-react";
import {
  type ImageAttachment,
  ImageMediaType,
  type ResendState,
} from "@repo/api";
import { MessageCard } from "@repo/ui/MessageCard";
import { UnansweredNotice } from "@repo/ui/UnansweredNotice";
import { Exit, Option, Schema } from "effect";
import { useState } from "react";
import { sendMessageAtom } from "./atoms";

const decodeMediaType = Schema.decodeUnknownOption(ImageMediaType);

// The transcript carries a message's images as base64 data URLs; a send carries type and bytes.
const attachmentOf = (url: string): ImageAttachment | undefined => {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(url);
  if (!match?.[1] || !match[2]) return undefined;
  const data = match[2];
  return Option.getOrUndefined(
    Option.map(decodeMediaType(match[1]), (mediaType) => ({ mediaType, data })),
  );
};

// A developer's message Claude Code never replied to, which they can send again as it was.
export function UnansweredPrompt({
  sessionId,
  text,
  images,
}: {
  sessionId: string;
  text: string;
  images: ReadonlyArray<string> | undefined;
}) {
  const send = useAtomSet(sendMessageAtom, { mode: "promiseExit" });
  const [state, setState] = useState<ResendState>("idle");

  const resend = async () => {
    setState("sending");
    const exit = await send({
      params: { id: sessionId },
      payload: {
        text,
        images: (images ?? []).flatMap((url) => attachmentOf(url) ?? []),
      },
    });
    setState(Exit.isSuccess(exit) ? "sent" : "failed");
  };

  return (
    <MessageCard
      images={images}
      footer={<UnansweredNotice state={state} onResend={() => void resend()} />}
    >
      {text}
    </MessageCard>
  );
}
