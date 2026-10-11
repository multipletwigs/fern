import { Collapsible } from "@base-ui/react/collapsible";
import { code } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";
import type { TranscriptItem } from "@repo/api";
import { clsx } from "clsx";
import type { ReactNode } from "react";
import { Streamdown } from "streamdown";

type ToolCall = Extract<TranscriptItem, { _tag: "ToolCall" }>;

const plugins = { code, mermaid };

export function ItemView({ item }: { item: TranscriptItem }) {
  switch (item._tag) {
    case "Prompt":
      return (
        <div className="mt-10 mb-6 rounded-2xl border border-hairline bg-white/[0.035] px-5 py-4 text-[15px] leading-7 whitespace-pre-wrap">
          {item.text}
        </div>
      );
    case "Command":
      return (
        <div className="mt-10 mb-6 flex items-baseline gap-3 rounded-2xl border border-hairline bg-white/[0.035] px-5 py-4">
          <span className="shrink-0 font-mono text-sm whitespace-nowrap text-ice">
            {item.name}
          </span>
          <span className="truncate text-sm text-muted">{item.args}</span>
        </div>
      );
    case "Text":
      return (
        <div className="my-4 text-[15px] leading-7 text-ink/90">
          <Streamdown
            plugins={plugins}
            shikiTheme={["github-dark", "github-dark"]}
          >
            {item.markdown}
          </Streamdown>
        </div>
      );
    case "Thinking":
      return (
        <Expandable label={<span className="italic">Thinking</span>}>
          <p className="text-sm leading-6 whitespace-pre-wrap text-muted">
            {item.text}
          </p>
        </Expandable>
      );
    case "ToolCall":
      return item.questions ? (
        <Questions call={item} />
      ) : (
        <ToolCallView call={item} />
      );
    case "Interrupt":
      return <Chip className="text-amber">Interrupted</Chip>;
    case "Notice":
      return <Chip className="text-muted">{item.text}</Chip>;
    default:
      return null;
  }
}

function Chip({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  return (
    <div className="my-5 flex justify-center">
      <span
        className={clsx(
          "rounded-full border border-hairline px-3 py-1 text-xs",
          className,
        )}
      >
        {children}
      </span>
    </div>
  );
}

function Expandable({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible.Root className="my-1.5">
      <Collapsible.Trigger className="group flex w-full items-center gap-2.5 text-left text-sm text-muted hover:text-ink">
        {label}
        <span className="text-faint transition-transform group-data-[panel-open]:rotate-90">
          ›
        </span>
      </Collapsible.Trigger>
      <Collapsible.Panel className="mt-2 mb-4 ml-4 border-l border-hairline pl-4">
        {children}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

const displayName = (name: string) =>
  name.startsWith("mcp__") ? name.split("__").slice(1).join(" · ") : name;

function ToolCallView({ call }: { call: ToolCall }) {
  const status = !call.result
    ? "bg-ice animate-pulse"
    : call.result.isError
      ? "bg-danger"
      : "bg-ice/50";
  return (
    <Expandable
      label={
        <span className="flex min-w-0 items-center gap-2.5">
          <span className={clsx("size-1.5 shrink-0 rounded-full", status)} />
          <span className="shrink-0 font-mono text-[13px] text-ink/80">
            {displayName(call.name)}
          </span>
          <span className="truncate font-mono text-[13px] text-faint">
            {call.summary}
          </span>
        </span>
      }
    >
      {call.diff ? <Diff lines={call.diff} /> : <Pre text={call.input} />}
      {call.result && (
        <Pre
          text={call.result.text || "(no output)"}
          className={call.result.isError ? "text-danger" : undefined}
        />
      )}
    </Expandable>
  );
}

function Pre({ text, className }: { text: string; className?: string }) {
  return (
    <pre
      className={clsx(
        "my-2 max-h-80 overflow-auto rounded-xl bg-white/[0.025] p-3 font-mono text-xs leading-5 whitespace-pre-wrap text-muted",
        className,
      )}
    >
      {text}
    </pre>
  );
}

function Diff({ lines }: { lines: ReadonlyArray<string> }) {
  return (
    <pre className="my-2 max-h-96 overflow-auto rounded-xl bg-white/[0.025] py-3 font-mono text-xs leading-5">
      {lines.map((line, index) => (
        <div
          // Lines in a diff are positional; nothing else identifies them.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          className={clsx(
            "px-3 whitespace-pre-wrap",
            line.startsWith("+")
              ? "bg-ice/[0.06] text-ice/90"
              : "bg-danger/[0.06] text-danger/80",
          )}
        >
          {line}
        </div>
      ))}
    </pre>
  );
}

// AskUserQuestion as the card it was meant to be: the question, its options, and the answer given.
function Questions({ call }: { call: ToolCall }) {
  const answered = (label: string) =>
    call.result?.text.includes(`="${label}"`) ?? false;
  return (
    <div className="my-6 space-y-4">
      {call.questions?.map((q) => (
        <div
          key={q.question}
          className="rounded-2xl border border-hairline bg-white/[0.02] p-5"
        >
          <p className="text-xs tracking-wide text-ice/80 uppercase">
            {q.header}
          </p>
          <p className="mt-2 text-[15px] leading-6">{q.question}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {q.options.map((label) => (
              <span
                key={label}
                className={clsx(
                  "rounded-full border px-3 py-1 text-sm",
                  answered(label)
                    ? "border-amber/40 bg-amber/10 text-amber"
                    : "border-hairline text-muted",
                )}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
