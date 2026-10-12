// Writes Sessions with Subagents into a Claude Code config folder, the way Claude Code 2.1.x lays
// them out, and reads where each Subagent stands through the Live RPCs.
import { assert } from "@effect/vitest";
import { LiveRpcs, type TranscriptItem } from "@repo/api";
import { Effect, Stream } from "effect";
import { RpcTest } from "effect/rpc";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const at = (second: number) =>
  `2026-10-11T10:00:${String(second).padStart(2, "0")}.000Z`;

let n = 0;

// One transcript's lines, each chained to the one before, as Claude Code writes them. `second` is
// left out of a line written without a timestamp.
export const transcriptOf = (sessionId: string, agentId?: string) => {
  let parent: string | null = null;
  return (
    second: number | undefined,
    type: "user" | "assistant",
    message: object,
    extra: object = {},
  ) => {
    const uuid = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    const entry = {
      type,
      uuid,
      parentUuid: parent,
      sessionId,
      ...(second === undefined ? {} : { timestamp: at(second) }),
      cwd: "/repo",
      entrypoint: "cli",
      ...(agentId ? { isSidechain: true, agentId } : {}),
      message,
      ...extra,
    };
    parent = uuid;
    return JSON.stringify(entry);
  };
};

export const assistant = (content: ReadonlyArray<object>) => ({
  id: `msg_${++n}`,
  role: "assistant",
  model: "claude-opus-5-5",
  content,
});
export const user = (content: string | ReadonlyArray<object>) => ({
  role: "user",
  content,
});
export const toolUse = (id: string, name: string, input: object) => ({
  type: "tool_use",
  id,
  name,
  input,
});
export const result = (id: string, text: string, isError = false) => ({
  type: "tool_result",
  tool_use_id: id,
  content: [{ type: "text", text }],
  ...(isError ? { is_error: true } : {}),
});
export const text = (markdown: string) => ({ type: "text", text: markdown });
export const launched = (agentId: string) =>
  `Async agent launched successfully.\nagentId: ${agentId} (internal ID)`;
export const notification = (callId: string, status: string) =>
  `<task-notification>\n<tool-use-id>${callId}</tool-use-id>\n<status>${status}</status>\n<summary>Agent ${status}</summary>\n</task-notification>`;

// A config folder of its own, which the Agent SDK reads through CLAUDE_CONFIG_DIR.
export const makeConfig = () => {
  const configDir = mkdtempSync(join(tmpdir(), "fern-claude-"));
  process.env.CLAUDE_CONFIG_DIR = configDir;
  const projectDir = join(configDir, "projects", "-repo");
  mkdirSync(projectDir, { recursive: true });
  return projectDir;
};

// As if Claude Code last wrote the file this many minutes ago.
export const age = (file: string, minutes: number) => {
  const then = new Date(Date.now() - minutes * 60_000);
  utimesSync(file, then, then);
};

// A Session's transcript, and its Subagents' transcripts and metadata beside it.
export const writeSession = (
  projectDir: string,
  sessionId: string,
  lines: ReadonlyArray<string>,
) => {
  const session = join(projectDir, `${sessionId}.jsonl`);
  writeFileSync(session, `${lines.join("\n")}\n`);
  const subagentsDir = join(projectDir, sessionId, "subagents");
  mkdirSync(subagentsDir, { recursive: true });
  return {
    session,
    // Writes the Subagent's transcript and metadata, and returns the transcript's path.
    subagent: (
      agentId: string,
      toolUseId: string,
      body: ReadonlyArray<string> | string,
    ) => {
      const file = join(subagentsDir, `agent-${agentId}.jsonl`);
      writeFileSync(
        file,
        typeof body === "string" ? body : `${body.join("\n")}\n`,
      );
      writeFileSync(
        join(subagentsDir, `agent-${agentId}.meta.json`),
        JSON.stringify({ toolUseId, spawnDepth: 1 }),
      );
      return file;
    },
  };
};

export const makeLive = RpcTest.makeClient(LiveRpcs);

// The chat row's status for each Agent call.
export const rowStatuses = (items: ReadonlyArray<TranscriptItem>) =>
  Object.fromEntries(
    items.flatMap((item) =>
      item._tag === "Subagent" ? [[item.callId, item.status]] : [],
    ),
  );

// Where a Subagent stands on its row in the chat, in the tab bar and on its own tab.
export const statuses = (sessionId: string, agentId: string, callId: string) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    const [chat] = yield* live
      .Transcript({ id: sessionId })
      .pipe(Stream.take(1), Stream.runCollect);
    const [list] = yield* live
      .Subagents({ sessionId })
      .pipe(Stream.take(1), Stream.runCollect);
    const [view] = yield* live
      .Subagent({ sessionId, agentId })
      .pipe(Stream.take(1), Stream.runCollect);
    if (view === undefined) return assert.fail("no view");
    return {
      row: rowStatuses(chat?.upserts ?? [])[callId],
      tab: list?.find((s) => s.agentId === agentId)?.status,
      view: view.header.status,
    };
  });
