import { TERMINAL_INPUT_MAX } from "@repo/api";

// What the page tells a Session's shell, in the order it happened.
export type Outgoing =
  | { readonly _tag: "Input"; readonly data: string }
  | { readonly _tag: "Resize"; readonly cols: number; readonly rows: number };

// `data` in pieces the server takes, none ending halfway through a character.
const pieces = (data: string) => {
  const all: Array<string> = [];
  let at = 0;
  while (data.length - at > TERMINAL_INPUT_MAX) {
    let end = at + TERMINAL_INPUT_MAX;
    const last = data.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    all.push(data.slice(at, end));
    at = end;
  }
  all.push(data.slice(at));
  return all;
};

// The writes to send for what happened: keystrokes typed back to back go as one write, a paste
// too big for one goes as several, and the order of everything stays.
export const outgoing = (messages: ReadonlyArray<Outgoing>) =>
  messages
    .reduce<Array<Outgoing>>((sent, message) => {
      const last = sent.at(-1);
      if (last?._tag === "Input" && message._tag === "Input")
        sent[sent.length - 1] = {
          _tag: "Input",
          data: last.data + message.data,
        };
      else sent.push(message);
      return sent;
    }, [])
    .flatMap((message): Array<Outgoing> =>
      message._tag === "Input"
        ? pieces(message.data).map((data) => ({ _tag: "Input", data }))
        : [message],
    );
