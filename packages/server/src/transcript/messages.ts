import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  Message,
  MessageParam,
  Usage,
} from "@anthropic-ai/sdk/resources/messages";
import { Predicate } from "effect";

// Reading what Claude Code stored in a transcript, for the Session's own and its Subagents'.

// The SDK types `message` as unknown, but it is the API message Claude Code stored, so it is read
// with the Anthropic SDK's own types.
export const userMessage = (m: SessionMessage) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  m.message as MessageParam;
export const assistantMessage = (m: SessionMessage) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  m.message as Message;

// A string field of a tool call's input.
export const field = (input: unknown, key: string) =>
  Predicate.hasProperty(input, key) && Predicate.isString(input[key])
    ? input[key]
    : undefined;

// The text inside the first `<name>` tag Claude Code put in a message.
export const tag = (text: string, name: string) =>
  new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim();

// Everything a request read, cached or not, plus what it wrote: the context the next request starts
// from. Synthetic messages, such as API errors Claude Code records, carry none.
export const usageTotal = (usage: Usage | null | undefined) =>
  usage
    ? usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      usage.output_tokens
    : 0;
