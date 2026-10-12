import type { ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import type { SubagentStatus, TranscriptItem } from "@repo/api";
import { Predicate } from "effect";
import type { SubagentMetadata } from "./SubagentFiles";

// An Agent call in a transcript, read as the Subagent it started.

// Claude Code's Agent tool, called Task before 2.x.
export const isAgentCall = (block: ToolUseBlock) =>
  block.name === "Agent" || block.name === "Task";

const field = (input: unknown, key: string) =>
  Predicate.hasProperty(input, key) && Predicate.isString(input[key])
    ? input[key]
    : undefined;

const tag = (text: string, name: string) =>
  new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim();

// What the Agent call's result says of the Subagent: its id, and whether it only started it in the
// background.
const AGENT_ID = /agentId: ([\w-]+)|message from "([^"]+)"/;
const LAUNCHED = /^\s*Async agent launched/;

// How the Session learned that a background Subagent ended, by Agent call id or agent id.
export interface Endings {
  readonly byCall: Map<string, SubagentStatus>;
  readonly byAgent: Map<string, SubagentStatus>;
}

// Reads one user message's text for a background Subagent's ending into `endings`: Claude Code's
// task notification, naming the Agent call and how it ended, or the Hand-back it delivers as a
// message from the Subagent.
export const readEnding = (text: string, endings: Endings) => {
  const notification = tag(text, "task-notification");
  const call = notification && tag(notification, "tool-use-id");
  if (notification && call) {
    const status = tag(notification, "status");
    endings.byCall.set(
      call,
      status === "completed"
        ? "done"
        : // Stopped by the developer, which Claude Code also calls killed.
          status === "killed" || status === "stopped"
          ? "stopped"
          : "failed",
    );
  }
  const from = /<agent-message from="([^"]+)">/.exec(text)?.[1];
  if (from) endings.byAgent.set(from, "done");
};

export const subagentItem = (
  block: ToolUseBlock,
  id: string,
  result: { readonly text: string; readonly isError: boolean } | undefined,
  metadata: SubagentMetadata | undefined,
  endings: Endings,
): TranscriptItem => {
  const fromResult = result && AGENT_ID.exec(result.text);
  const agentId =
    metadata?.agentId ?? fromResult?.[1] ?? fromResult?.[2] ?? undefined;
  const ended =
    endings.byCall.get(block.id) ??
    (agentId === undefined ? undefined : endings.byAgent.get(agentId));
  const status: SubagentStatus = result?.isError
    ? "failed"
    : result && !LAUNCHED.test(result.text)
      ? "done"
      : (ended ?? "running");
  return {
    _tag: "Subagent",
    id,
    callId: block.id,
    agentId,
    agentType:
      metadata?.agentType ?? field(block.input, "subagent_type") ?? "Subagent",
    description:
      metadata?.description ??
      field(block.input, "description") ??
      field(block.input, "prompt")?.trim().split("\n")[0] ??
      "",
    status,
  };
};
