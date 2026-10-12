import type {
  SDKSessionInfo,
  SessionMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  Message,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
  Usage,
} from "@anthropic-ai/sdk/resources/messages";
import {
  type HostedTurn,
  PromptCache,
  SessionHeader,
  type TranscriptItem,
} from "@repo/api";
import { DateTime, Duration, Option, Predicate, Schema } from "effect";
import {
  type Endings,
  isAgentCall,
  readEnding,
  subagentItem,
} from "../subagent/SubagentCall";
import type { SubagentMetadata } from "../subagent/SubagentFiles";
import {
  assistantMessage,
  field,
  tag,
  usageTotal,
  userMessage,
} from "./messages";

// Turns the messages the Agent SDK reads from a transcript into renderable items. The SDK has
// already resolved the active branch and dropped injected skill bodies.

const MAX_RESULT_CHARS = 6_000;
const MAX_DIFF_LINES = 600;

// Fields the SDK passes through from the transcript line without declaring them.
export type StoredMessage = SessionMessage & {
  readonly timestamp?: string;
  readonly is_meta?: boolean;
  readonly origin?: { readonly kind: string; readonly name?: string };
};

// What Claude Code records in place of a reply when it resumes a Session whose last message never
// got one. It isn't Claude replying, so it marks that message unanswered instead.
const isNoResponsePlaceholder = (message: Message) =>
  message.model === "<synthetic>" &&
  message.content.length === 1 &&
  message.content[0]?.type === "text" &&
  message.content[0].text === "No response requested.";

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

// Base64 images in a user message, as data URLs.
const imagesOf = (content: MessageParam["content"]) =>
  Predicate.isString(content)
    ? []
    : content.flatMap((part) =>
        part.type === "image" && part.source.type === "base64"
          ? [`data:${part.source.media_type};base64,${part.source.data}`]
          : [],
      );

const stripReminders = (text: string) =>
  text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();

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
    path:
      field(block.input, "file_path") ?? field(block.input, "notebook_path"),
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

// The Hand-back in a message Claude Code delivers from a Subagent: after its frame, with the indent
// the harness puts on every line taken off.
const deliveredHandBack = (text: string) => {
  const body = /<agent-message from="[^"]+">([\s\S]*?)<\/agent-message>/.exec(
    text,
  )?.[1];
  if (body === undefined) return "";
  const marker = "The report follows:\n";
  const at = body.indexOf(marker);
  return (at === -1 ? body : body.slice(at + marker.length))
    .split("\n")
    .map((line) => line.replace(/^ {2}/, ""))
    .join("\n")
    .trim();
};

const fromUser = (
  m: StoredMessage,
  text: string,
  images: ReadonlyArray<string>,
  subagents: ReadonlyArray<SubagentMetadata>,
): TranscriptItem | undefined => {
  const id = m.uuid;
  if (m.is_meta) {
    const from = /<agent-message from="([^"]+)">/.exec(text)?.[1];
    return from
      ? {
          _tag: "HandBack",
          id,
          agentId: from,
          agentType:
            subagents.find((s) => s.agentId === from)?.agentType ??
            m.origin?.name ??
            "Subagent",
          text: deliveredHandBack(text),
        }
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
  if (prompt.startsWith("<local-command-")) return undefined;
  if (!prompt && images.length === 0) return undefined;
  return {
    _tag: "Prompt",
    id,
    text: prompt,
    images: images.length > 0 ? images : undefined,
  };
};

// Turns a transcript's messages into items: the Session's own, or a Subagent's.
export const buildItems = (
  messages: ReadonlyArray<StoredMessage>,
  context: {
    // The folder the transcript ran in, left out of the paths its tool calls name.
    readonly cwd: string;
    // What Claude Code recorded of the Session's Subagents beside its transcript.
    readonly subagents?: ReadonlyArray<SubagentMetadata>;
  },
) => {
  const { cwd } = context;
  const subagents = new Map(
    (context.subagents ?? []).flatMap((s) =>
      s.toolUseId === undefined ? [] : [[s.toolUseId, s] as const],
    ),
  );
  const endings: Endings = { byCall: new Map(), byAgent: new Map() };
  const results = new Map<string, { text: string; isError: boolean }>();
  for (const m of messages) {
    if (m.type !== "user") continue;
    const { content } = userMessage(m);
    readEnding(textOf(content), endings);
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
  for (const m of messages) {
    if (m.type === "user") {
      const { content } = userMessage(m);
      const text = textOf(content);
      const images = imagesOf(content);
      const item =
        text || images.length > 0
          ? fromUser(m, text, images, context.subagents ?? [])
          : undefined;
      if (item) items.push(item);
    } else if (m.type === "assistant") {
      const message = assistantMessage(m);
      if (isNoResponsePlaceholder(message)) {
        const last = items.at(-1);
        if (last?._tag === "Prompt")
          items[items.length - 1] = { ...last, unanswered: true };
        continue;
      }
      message.content.forEach((block, index) => {
        const id = `${m.uuid}:${index}`;
        if (block.type === "text" && block.text.trim())
          items.push({ _tag: "Text", id, markdown: block.text.trim() });
        // Transcripts usually store thinking redacted; an empty block isn't worth a row.
        else if (block.type === "thinking" && block.thinking.trim())
          items.push({ _tag: "Thinking", id, text: block.thinking });
        else if (block.type === "tool_use")
          items.push(
            isAgentCall(block)
              ? subagentItem(
                  block,
                  id,
                  results.get(block.id),
                  subagents.get(block.id),
                  endings,
                )
              : toolCall(block, id, results.get(block.id), cwd),
          );
      });
    }
  }
  return items;
};

// The text a user message carries, without Claude Code's reminders: a Subagent's Assignment.
export const promptText = (m: SessionMessage) =>
  stripReminders(textOf(userMessage(m).content));

export const buildView = (
  info: SDKSessionInfo,
  messages: ReadonlyArray<StoredMessage>,
  context: {
    readonly hostedTurn?: HostedTurn;
    // The window's size as a turn Fern ran on the Session last reported it, if one has: the
    // transcript doesn't record it.
    readonly contextWindow?: number;
    // What Claude Code recorded of the Session's Subagents beside its transcript.
    readonly subagents?: ReadonlyArray<SubagentMetadata>;
  } = {},
) => {
  const { hostedTurn, contextWindow } = context;
  const items = buildItems(messages, {
    cwd: info.cwd ?? "",
    subagents: context.subagents,
  });

  let model: string | undefined;
  let contextTokens: number | undefined;
  let usage: Usage | undefined;
  let lastRequestAt: DateTime.Utc | undefined;
  let cacheTtl = Duration.minutes(5);
  for (const m of messages) {
    if (m.type !== "assistant") continue;
    const message = assistantMessage(m);
    if (isNoResponsePlaceholder(message)) continue;
    model = message.model;
    const total = usageTotal(message.usage);
    if (total > 0 && m.parent_tool_use_id === null) {
      contextTokens = total;
      usage = message.usage;
    }
    if (m.timestamp) lastRequestAt = DateTime.makeUnsafe(m.timestamp);
    if ((message.usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0) > 0)
      cacheTtl = Duration.hours(1);
  }

  const header = SessionHeader.make({
    id: info.sessionId,
    title: info.customTitle ?? info.summary,
    cwd: info.cwd,
    gitBranch: info.gitBranch,
    model,
    contextTokens,
    contextWindow: contextWindow ?? hostedTurn?.contextWindow,
    lastActivityAt: DateTime.makeUnsafe(info.lastModified),
    cache:
      lastRequestAt &&
      PromptCache.make({
        lastRequestAt,
        ttl: cacheTtl,
        expiresAt: DateTime.addDuration(lastRequestAt, cacheTtl),
        readTokens: usage?.cache_read_input_tokens ?? 0,
        writtenTokens: usage?.cache_creation_input_tokens ?? 0,
        uncachedTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
      }),
    hostedTurn,
  });

  return { header, items };
};
