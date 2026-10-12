import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages";
import { Predicate } from "effect";
import type { StoredMessage } from "../transcript/View";

// What a Subagent's own transcript says of its work. Claude Code records the same stats on the
// Agent call's result, but the Agent SDK doesn't pass them through, so they are worked out here.

// The SDK types `message` as unknown, but it is the API message Claude Code stored.
const assistantMessage = (m: SessionMessage) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  m.message as Message;

const replies = (messages: ReadonlyArray<StoredMessage>) =>
  messages.flatMap((m) =>
    m.type === "assistant" ? [assistantMessage(m)] : [],
  );

// The Subagent's final answer: the message of its last SubagentHandback call, or else, once it has
// ended, the text it ended on. While it runs, text it just wrote may yet be followed by a tool call.
export const handBackOf = (
  messages: ReadonlyArray<StoredMessage>,
  ended: boolean,
) => {
  const handback = replies(messages)
    .flatMap((reply) => reply.content)
    .findLast(
      (block) => block.type === "tool_use" && block.name === "SubagentHandback",
    );
  if (
    handback?.type === "tool_use" &&
    Predicate.hasProperty(handback.input, "message") &&
    Predicate.isString(handback.input.message)
  )
    return handback.input.message;
  if (!ended) return undefined;
  // Messages Claude Code injects, such as a nested Subagent's Hand-back, aren't a reply.
  const last = messages.findLast((m) => !m.is_meta);
  if (last?.type !== "assistant") return undefined;
  const final = assistantMessage(last).content.at(-1);
  return final?.type === "text" && final.text.trim()
    ? final.text.trim()
    : undefined;
};

// Whether the Subagent's last reply called a tool whose result isn't written yet.
export const awaitsTool = (messages: ReadonlyArray<StoredMessage>) => {
  const last = messages.findLast((m) => !m.is_meta);
  return (
    last?.type === "assistant" &&
    assistantMessage(last).content.some((block) => block.type === "tool_use")
  );
};

export const statsOf = (messages: ReadonlyArray<StoredMessage>) => {
  const times = messages.flatMap((m) =>
    m.timestamp ? [Date.parse(m.timestamp)] : [],
  );
  const calls = new Set<string>();
  let tokens = 0;
  for (const reply of replies(messages)) {
    for (const block of reply.content)
      if (block.type === "tool_use") calls.add(block.id);
    // Claude Code writes each block of a reply on a line of its own, each with the reply's usage
    // so far, so the last one with usage counts.
    const usage = reply.usage;
    const total = usage
      ? usage.input_tokens +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        usage.output_tokens
      : 0;
    if (total > 0) tokens = total;
  }
  return {
    durationMs:
      times.length === 0 ? 0 : Math.max(...times) - Math.min(...times),
    toolCalls: calls.size,
    tokens,
  };
};
