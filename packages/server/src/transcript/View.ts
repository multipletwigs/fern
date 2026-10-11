import type {
  SDKSessionInfo,
  SessionMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  Message,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { SessionHeader, type TranscriptItem } from "@repo/api";
import { DateTime, Duration, Option, Predicate, Schema } from "effect";

// Turns the messages the Agent SDK reads from a transcript into renderable items. The SDK has
// already resolved the active branch and dropped injected skill bodies.

const MAX_RESULT_CHARS = 6_000;
const MAX_DIFF_LINES = 600;

// Fields the SDK passes through from the transcript line without declaring them.
type StoredMessage = SessionMessage & {
  readonly timestamp?: string;
  readonly is_meta?: boolean;
  readonly origin?: { readonly kind: string };
};

// The SDK types `message` as unknown, but it is the API message Claude Code stored, so it is read
// with the Anthropic SDK's own types.
const userMessage = (m: SessionMessage) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  m.message as MessageParam;
const assistantMessage = (m: SessionMessage) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  m.message as Message;

const decodeQuestions = Schema.decodeUnknownOption(
  Schema.Struct({
    questions: Schema.Array(
      Schema.Struct({
        question: Schema.String,
        header: Schema.String,
        options: Schema.Array(Schema.Struct({ label: Schema.String })),
      }),
    ),
  }),
);

const textOf = (
  content: MessageParam["content"] | ToolResultBlockParam["content"],
) =>
  Predicate.isString(content)
    ? content
    : (content ?? [])
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n");

const tag = (text: string, name: string) =>
  new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim();

const stripReminders = (text: string) =>
  text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();

const field = (input: unknown, key: string) =>
  Predicate.hasProperty(input, key) && Predicate.isString(input[key])
    ? input[key]
    : undefined;

const prefixLines = (text: string | undefined, prefix: string) =>
  text === undefined ? [] : text.split("\n").map((line) => prefix + line);

// The input field that best describes a call, e.g. the file for Edit or the command for Bash.
const SUMMARY_FIELDS = [
  "description",
  "file_path",
  "notebook_path",
  "pattern",
  "command",
  "skill",
  "url",
  "query",
  "prompt",
];

const toolCall = (
  block: ToolUseBlock,
  id: string,
  result: { text: string; isError: boolean } | undefined,
  cwd: string,
): TranscriptItem => {
  const summary = SUMMARY_FIELDS.map((key) => field(block.input, key)).find(
    Predicate.isString,
  );
  const diff =
    block.name === "Edit"
      ? [
          ...prefixLines(field(block.input, "old_string"), "-"),
          ...prefixLines(field(block.input, "new_string"), "+"),
        ]
      : block.name === "Write"
        ? prefixLines(field(block.input, "content"), "+")
        : undefined;
  return {
    _tag: "ToolCall",
    id,
    name: block.name,
    summary: (summary ?? "").replace(`${cwd}/`, "").split("\n")[0] ?? "",
    input: JSON.stringify(block.input, null, 2),
    result,
    diff: diff?.slice(0, MAX_DIFF_LINES),
    questions: Option.getOrUndefined(
      Option.map(decodeQuestions(block.input), ({ questions }) =>
        questions.map((q) => ({
          header: q.header,
          question: q.question,
          options: q.options.map((o) => o.label),
        })),
      ),
    ),
  };
};

const fromUser = (
  m: StoredMessage,
  text: string,
): TranscriptItem | undefined => {
  const id = m.uuid;
  if (m.is_meta) {
    const from = /<agent-message from="([^"]+)">/.exec(text)?.[1];
    return from
      ? { _tag: "Notice", id, text: `Report from agent ${from}` }
      : undefined;
  }
  if (m.origin?.kind === "task-notification")
    return {
      _tag: "Notice",
      id,
      text: tag(text, "summary") ?? "Background task finished",
    };
  if (text.startsWith("[Request interrupted by user"))
    return { _tag: "Interrupt", id };
  const command = tag(text, "command-name");
  if (command)
    return {
      _tag: "Command",
      id,
      name: command,
      args: tag(text, "command-args") ?? "",
    };
  const prompt = stripReminders(text);
  return prompt && !prompt.startsWith("<local-command-")
    ? { _tag: "Prompt", id, text: prompt }
    : undefined;
};

export const buildView = (
  info: SDKSessionInfo,
  messages: ReadonlyArray<StoredMessage>,
) => {
  const cwd = info.cwd ?? "";
  const results = new Map<string, { text: string; isError: boolean }>();
  for (const m of messages) {
    if (m.type !== "user") continue;
    const { content } = userMessage(m);
    if (Predicate.isString(content)) continue;
    for (const block of content)
      if (block.type === "tool_result")
        results.set(block.tool_use_id, {
          text: stripReminders(textOf(block.content)).slice(
            0,
            MAX_RESULT_CHARS,
          ),
          isError: block.is_error ?? false,
        });
  }

  const items: Array<TranscriptItem> = [];
  let model: string | undefined;
  let lastRequestAt: DateTime.Utc | undefined;
  let cacheTtl = Duration.minutes(5);

  for (const m of messages) {
    if (m.type === "user") {
      const text = textOf(userMessage(m).content);
      const item = text ? fromUser(m, text) : undefined;
      if (item) items.push(item);
    } else if (m.type === "assistant") {
      const message = assistantMessage(m);
      model = message.model;
      if (m.timestamp) lastRequestAt = DateTime.makeUnsafe(m.timestamp);
      if ((message.usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0) > 0)
        cacheTtl = Duration.hours(1);
      message.content.forEach((block, index) => {
        const id = `${m.uuid}:${index}`;
        if (block.type === "text" && block.text.trim())
          items.push({ _tag: "Text", id, markdown: block.text.trim() });
        // Transcripts usually store thinking redacted; an empty block isn't worth a row.
        else if (block.type === "thinking" && block.thinking.trim())
          items.push({ _tag: "Thinking", id, text: block.thinking });
        else if (block.type === "tool_use")
          items.push(toolCall(block, id, results.get(block.id), cwd));
      });
    }
  }

  const header = SessionHeader.make({
    id: info.sessionId,
    title: info.customTitle ?? info.summary,
    cwd: info.cwd,
    gitBranch: info.gitBranch,
    model,
    lastActivityAt: DateTime.makeUnsafe(info.lastModified),
    cacheExpiresAt:
      lastRequestAt && DateTime.addDuration(lastRequestAt, cacheTtl),
  });

  return { header, items };
};
