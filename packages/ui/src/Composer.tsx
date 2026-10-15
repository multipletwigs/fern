import { ArrowUpIcon, ImageIcon, StopIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Column } from "./Column";
import { CommandMenu, type ComposerCommand } from "./CommandMenu";
import { ImageThumb } from "./ImageThumb";
import { Loader } from "./Loader";
import { type ComposerImage, imageFiles, readImage } from "./readImage";

export type { ComposerCommand } from "./CommandMenu";
export type { ComposerImage } from "./readImage";

const MAX_MATCHES = 50;

// Commands whose name starts with what's typed, then ones that merely contain it.
const matching = (commands: ReadonlyArray<ComposerCommand>, typed: string) => {
  const query = typed.toLowerCase();
  const starts = commands.filter((c) => c.name.toLowerCase().startsWith(query));
  const contains = commands.filter(
    (c) =>
      !c.name.toLowerCase().startsWith(query) &&
      c.name.toLowerCase().includes(query),
  );
  return [...starts, ...contains].slice(0, MAX_MATCHES);
};

// A button lifted off the box the way the active sidebar tab is lifted off the sidebar.
const raised =
  "flex size-8 items-center justify-center rounded-lg bg-white/[0.09] text-ink shadow-[0_1px_2px_rgb(0_0_0/0.5),inset_0_1px_0_rgb(255_255_255/0.08)] transition-[background-color,opacity] hover:bg-white/[0.14] disabled:opacity-30 disabled:hover:bg-white/[0.09]";

// The message box under a transcript, a raised surface like the active sidebar tab. Enter sends,
// Shift+Enter adds a line. Images can be pasted, dropped, or picked. Typing "/" offers the slash
// commands; a chosen one sits at the start of the box as a chip, and what follows is its
// arguments. While a turn runs, an empty box offers Stop, and a message sent then queues behind
// the turn.
export function Composer({
  placeholder,
  disabled = false,
  running,
  notice,
  commands = [],
  tools,
  above,
  onSend,
  onStop,
}: {
  placeholder: string;
  disabled?: boolean;
  running: boolean;
  commands?: ReadonlyArray<ComposerCommand>;
  // Shown above the box, e.g. why it's disabled or why the last turn failed.
  notice?: string;
  // Shown beside the image button, e.g. the model picker.
  tools?: ReactNode;
  // Shown just above the box, e.g. messages waiting for the running turn.
  above?: ReactNode;
  // Resolves true once the message is accepted. The box clears straight away and gets the message
  // back if it isn't.
  // `command` is the slash command, without its slash, when the message is one; `text` is then
  // its arguments.
  onSend: (message: {
    text: string;
    images: ReadonlyArray<ComposerImage>;
    command?: string;
  }) => Promise<boolean>;
  // Returns text to put back in the box, as when stopping drops queued messages.
  onStop: () => string | undefined | void;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<ReadonlyArray<ComposerImage>>([]);
  const [unreadable, setUnreadable] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const [command, setCommand] = useState<ComposerCommand>();
  const [highlighted, setHighlighted] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [chipWidth, setChipWidth] = useState(0);
  const picker = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const chip = useRef<HTMLSpanElement>(null);
  // Where to put the caret after the box's text is replaced.
  const caret = useRef<number>(undefined);

  const typedName =
    command === undefined ? /^\/(\S*)$/.exec(text)?.[1] : undefined;
  const matches = typedName === undefined ? [] : matching(commands, typedName);
  const menuOpen = !menuDismissed && matches.length > 0;
  const hasMessage =
    text.trim() !== "" || images.length > 0 || command !== undefined;
  const canSend = !disabled && !sending && hasMessage;

  // The chip sits over the first line, so that line starts after it.
  useLayoutEffect(() => {
    setChipWidth(command ? (chip.current?.offsetWidth ?? 0) : 0);
  }, [command]);
  useLayoutEffect(() => {
    if (caret.current === undefined) return;
    field.current?.setSelectionRange(caret.current, caret.current);
    caret.current = undefined;
  });

  const send = async (chosen = command, args = text) => {
    if (disabled || sending) return;
    // A known command typed out in full counts as picked.
    const typed = chosen
      ? undefined
      : /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(args.trim());
    const known =
      chosen ?? (typed ? commands.find((c) => c.name === typed[1]) : undefined);
    const rest = chosen || !known ? args : (typed?.[2] ?? "");
    if (!known && rest.trim() === "" && images.length === 0) return;
    // The box clears at once; a send that fails puts the message back, unless something new was
    // typed meanwhile.
    const draft = { text: args, images, command };
    setText("");
    setImages([]);
    setCommand(undefined);
    setSending(true);
    const sent = await onSend({
      text: rest.trim(),
      images,
      command: known?.name,
    });
    setSending(false);
    if (sent) return;
    setText((current) => current || draft.text);
    setImages((current) => (current.length > 0 ? current : draft.images));
    setCommand((current) => current ?? draft.command);
  };

  const pick = (picked: ComposerCommand, now: boolean) => {
    setCommand(picked);
    setText("");
    if (now) void send(picked, "");
  };

  const edit = (value: string) => {
    setHighlighted(0);
    setMenuDismissed(false);
    // A known command followed by a space becomes the chip.
    const typed = command === undefined && /^\/(\S+)\s/.exec(value);
    const known = typed && commands.find((c) => c.name === typed[1]);
    if (known && typed) {
      setCommand(known);
      setText(value.slice(typed[0].length));
      caret.current = 0;
    } else setText(value);
  };

  const attach = async (files: ReadonlyArray<File>) => {
    if (disabled || files.length === 0) return;
    const read = await Promise.all(
      files.map((file) => readImage(file).catch(() => undefined)),
    );
    const added = read.filter((image) => image !== undefined);
    setUnreadable(added.length < files.length);
    setImages((current) => [...current, ...added]);
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFiles(event.clipboardData.files);
    if (files.length === 0) return;
    // Copying an image from a page also carries its URL as text; keep only the image.
    event.preventDefault();
    void attach(files);
  };

  const onDragOver = (event: DragEvent) => {
    if (disabled || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragging(true);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void attach(imageFiles(event.dataTransfer.files));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    // With the menu open, Tab completes the highlighted command and Enter runs it.
    const choice = matches[highlighted];
    if (menuOpen && choice && !event.shiftKey) {
      const step = { ArrowDown: 1, ArrowUp: matches.length - 1 }[event.key];
      if (step !== undefined)
        setHighlighted((highlighted + step) % matches.length);
      else if (event.key === "Tab") pick(choice, false);
      else if (event.key === "Enter") pick(choice, true);
      else if (event.key === "Escape") setMenuDismissed(true);
      else return;
      event.preventDefault();
      return;
    }
    // Backspace at the very start takes the chip back into text, to edit or delete.
    if (
      event.key === "Backspace" &&
      command &&
      event.currentTarget.selectionStart === 0 &&
      event.currentTarget.selectionEnd === 0
    ) {
      event.preventDefault();
      setText(`/${command.name}${text}`);
      caret.current = command.name.length + 1;
      setCommand(undefined);
      setMenuDismissed(true);
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void send();
  };

  return (
    <Column className="shrink-0 pb-5">
      {(notice ?? unreadable) && (
        <p className="mb-2 px-1 text-xs text-muted">
          {notice ?? "Only PNG, JPEG, GIF, and WebP images can be attached."}
        </p>
      )}
      {above}
      <div
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={clsx(
          "relative flex flex-col rounded-2xl bg-white/[0.06] shadow-[0_1px_2px_rgb(0_0_0/0.5),0_10px_30px_rgb(0_0_0/0.35),inset_0_1px_0_rgb(255_255_255/0.06)] transition-colors focus-within:bg-white/[0.08]",
          dragging && "bg-white/[0.1]",
          disabled && "opacity-60",
        )}
      >
        {menuOpen && (
          <CommandMenu
            commands={matches}
            highlighted={highlighted}
            onHighlight={setHighlighted}
            onPick={(picked) => {
              pick(picked, false);
              field.current?.focus();
            }}
          />
        )}
        {images.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-3 pt-3">
            {images.map((image) => (
              <ImageThumb
                key={image.id}
                url={image.url}
                onRemove={() =>
                  setImages((current) =>
                    current.filter(({ id }) => id !== image.id),
                  )
                }
              />
            ))}
          </div>
        )}
        <div className="relative flex flex-col">
          {command && (
            <span
              ref={chip}
              className="pointer-events-none absolute top-3.5 left-4 rounded bg-white/10 px-1.5 font-pixel text-[13px] leading-6 text-ink"
            >
              /{command.name}
            </span>
          )}
          <textarea
            ref={field}
            value={text}
            onChange={(event) => edit(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => setMenuDismissed(true)}
            onFocus={() => setMenuDismissed(false)}
            disabled={disabled}
            placeholder={command ? command.argumentHint : placeholder}
            rows={3}
            style={command ? { textIndent: chipWidth + 6 } : undefined}
            className="max-h-72 min-h-[84px] resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-6 text-ink outline-none [field-sizing:content] placeholder:text-faint disabled:cursor-not-allowed"
          />
        </div>
        <div className="flex items-center justify-between p-2 pt-0">
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              onClick={() => picker.current?.click()}
              disabled={disabled}
              title="Attach images"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ImageIcon className="size-4" />
            </button>
            {tools}
          </div>
          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            hidden
            onChange={(event) => {
              void attach(imageFiles(event.target.files));
              event.target.value = "";
            }}
          />
          {running && !hasMessage ? (
            <button
              type="button"
              onClick={() => {
                const back = onStop();
                if (back) setText((current) => current || back);
              }}
              title="Stop"
              className={raised}
            >
              <StopIcon weight="fill" className="size-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              title={running ? "Queue" : "Send"}
              className={raised}
            >
              {sending ? (
                <Loader className="text-sm" />
              ) : (
                <ArrowUpIcon weight="bold" className="size-4" />
              )}
            </button>
          )}
        </div>
      </div>
    </Column>
  );
}
