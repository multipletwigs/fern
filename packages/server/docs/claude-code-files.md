# Claude Code's transcript and Subagent files

Claude Code doesn't document what it writes to disk, and the Agent SDK only exposes part of it. This is what Fern relies on, as seen in Claude Code 2.1.x with Agent SDK 0.3.296. Read files defensively: decode with Schema, keep every field optional, and fall back when one is missing.

## Layout

Everything lives under `$CLAUDE_CONFIG_DIR/projects/` (default `~/.claude/projects/`). Each project folder is named after the cwd, with every non-alphanumeric character turned into `-`.

```
<project>/<sessionId>.jsonl                          the Session's transcript, one JSON record per line
<project>/<sessionId>/subagents/agent-<agentId>.jsonl     one Subagent's transcript
<project>/<sessionId>/subagents/agent-<agentId>.meta.json its metadata
```

Nested Subagents sit flat in the same `subagents/` folder. Agent ids take the shape `a` and 16 hex digits, and the SDK rejects ids that don't match.

## What the Agent SDK passes through

`getSessionMessages` and `getSubagentMessages` return the `user` and `assistant` records on the active branch.

- **Passed through:** `type`, `uuid`, `session_id` and `message`, plus:
  - `parent_tool_use_id`;
  - `parent_agent_id`, set for Subagents at depth 2 and deeper;
  - `timestamp` and `origin`;
  - `is_meta`, which also covers compact summaries and transcript-only messages;
  - a few flags, such as `isQueuedCommand`.
- **Dropped:**
  - `toolUseResult`, the structured result Claude Code stores beside an Agent call's `tool_result`: `agentId`, `agentType`, `status`, `totalDurationMs`, `totalTokens`, `totalToolUseCount`, `usage` and `handbackReport`. Work stats out from the Subagent's own transcript instead.
  - `attachment` records.
  - `queue-operation` records.

`listSubagents(sessionId)` returns the agent ids. The SDK has no call for the metadata file, so read it with fs.

`listSessions` with `includeProgrammatic: false`, which Fern uses, hides Sessions whose records say `"entrypoint":"sdk-ts"`.

## Subagent metadata (`agent-<agentId>.meta.json`)

```json
{
  "agentType": "Explore",
  "description": "Map current subagent handling",
  "toolUseId": "toolu_…",
  "spawnDepth": 1,
  "requestShape": "foreground",
  "requestNonInteractive": true
}
```

- `toolUseId` is the id of the Agent tool_use that started the Subagent, in the delegating agent's transcript. It's the only link from a Subagent to its Agent call.
- `requestShape` is `foreground` or `background`.
- A nested Subagent may also carry `parentAgentId`. When it doesn't, its parent is the Subagent whose transcript holds the `toolUseId`.

## Subagent transcript

Every record has `isSidechain: true` and `agentId`. The first user message is the Assignment.

## Hand-backs

A Subagent's final answer reaches the delegating agent in one of these ways:

- **Through `SubagentHandback`:** the Subagent calls the `SubagentHandback` tool, and `input.message` is the Hand-back.
  - The Agent call's `tool_result` then only says `This agent's report was delivered to you as a message from "<agentId>" …`.
  - The delegating agent receives the text as an `is_meta` user message containing `<agent-message from="<agentId>">…</agent-message>`, with `origin.kind: "peer"`. The harness indents each line of the body by two spaces, after a `The report follows:` line.
- **Delivered mid-turn:** a foreground Hand-back that arrives while the delegating agent's turn is still running is stored as an `attachment` record. The SDK drops those, so the main transcript shows no message for it. Read it from the Subagent's transcript.
- **Plain text:** a Subagent that never calls `SubagentHandback` hands back its final assistant text, which is also the Agent call's `tool_result`.

## Background Subagents

- The Agent call's `tool_result` comes back at once with `Async agent launched successfully. agentId: …`.
- When the Subagent ends, Claude Code adds a user message with `origin.kind: "task-notification"`. It holds one or more `<task-notification>` blocks, each carrying `<tool-use-id>`, `<status>` (completed, failed, killed) and `<summary>`.
- A foreground Agent call the developer interrupted has an `is_error` result that starts with `[Request interrupted by user`.
