// A Subagent's tab shows its stats, worked out from its own transcript, and its Hand-back; its
// status is the same on its tab, in the tab bar and on its row in the chat.
import { assert, layer } from "@effect/vitest";
import { LiveRpcs, type TranscriptItem } from "@repo/api";
import { Effect, Layer, Stream } from "effect";
import { HttpServer } from "effect/http";
import { RpcTest } from "effect/rpc";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import { NoWorktreesDir, NoWriter } from "./stubs";

const SESSION = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
// Claude Code's own shape for agent ids: "a" and 16 hex digits.
const HANDBACK = "a1b0000000000001b";
const TEXT = "a2b0000000000002b";
const CUT = "a3b0000000000003b";
const RUNNING = "a4b0000000000004b";
const FAILED = "a5b0000000000005b";
const KILLED = "a6b0000000000006b";

const at = (second: number) =>
  `2026-10-11T10:00:${String(second).padStart(2, "0")}.000Z`;

let n = 0;
// One transcript's lines, each chained to the one before, as Claude Code writes them.
const transcriptOf = (agentId?: string) => {
  let parent: string | null = null;
  return (
    second: number,
    type: "user" | "assistant",
    message: object,
    extra: object = {},
  ) => {
    const uuid = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    const entry = {
      type,
      uuid,
      parentUuid: parent,
      sessionId: SESSION,
      timestamp: at(second),
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

const usage = {
  input_tokens: 2,
  cache_creation_input_tokens: 100,
  cache_read_input_tokens: 1000,
  output_tokens: 50,
};
const assistant = (content: ReadonlyArray<object>, id = `msg_${++n}`) => ({
  id,
  role: "assistant",
  model: "claude-opus-5-5",
  content,
  usage,
});
const user = (content: string | ReadonlyArray<object>) => ({
  role: "user",
  content,
});
const toolUse = (id: string, name: string, input: object) => ({
  type: "tool_use",
  id,
  name,
  input,
});
const result = (id: string, text: string, isError = false) => ({
  type: "tool_result",
  tool_use_id: id,
  content: [{ type: "text", text }],
  ...(isError ? { is_error: true } : {}),
});
const text = (markdown: string) => ({ type: "text", text: markdown });

const main = transcriptOf();
const sessionLines = [
  main(0, "user", user("Look into the code"), { origin: { kind: "human" } }),
  main(
    1,
    "assistant",
    assistant([
      toolUse("toolu_handback", "Agent", {
        description: "Map the code",
        subagent_type: "Explore",
        prompt: "Map how transcripts are read.",
      }),
      toolUse("toolu_text", "Agent", {
        description: "Find the tests",
        subagent_type: "Explore",
        prompt: "Find the tests.",
      }),
      toolUse("toolu_cut", "Agent", {
        description: "Write the recipe",
        subagent_type: "general-purpose",
        prompt: "Write a verify recipe.",
        run_in_background: true,
      }),
      toolUse("toolu_running", "Agent", {
        description: "Plan the work",
        subagent_type: "general-purpose",
        prompt: "Plan the work.",
        run_in_background: true,
      }),
      toolUse("toolu_failed", "Agent", {
        description: "Review the diff",
        subagent_type: "general-purpose",
        prompt: "Review the diff.",
      }),
      toolUse("toolu_killed", "Agent", {
        description: "Sweep the repo",
        subagent_type: "general-purpose",
        prompt: "Sweep the repo.",
        run_in_background: true,
      }),
    ]),
  ),
  main(
    20,
    "user",
    user([
      result(
        "toolu_handback",
        `This agent's report was delivered to you as a message from "${HANDBACK}" (its SubagentHandback call). Read it there; it is not repeated here.`,
      ),
      result("toolu_text", `Three tests cover it.\nagentId: ${TEXT}`),
      result(
        "toolu_cut",
        `Async agent launched successfully.\nagentId: ${CUT} (internal ID)`,
      ),
      result(
        "toolu_running",
        `Async agent launched successfully.\nagentId: ${RUNNING} (internal ID)`,
      ),
      result("toolu_failed", "API Error: overloaded", true),
      result(
        "toolu_killed",
        `Async agent launched successfully.\nagentId: ${KILLED} (internal ID)`,
      ),
    ]),
  ),
  // The developer stopped it.
  main(
    21,
    "user",
    user(
      `<task-notification>\n<task-id>${KILLED}</task-id>\n<tool-use-id>toolu_killed</tool-use-id>\n<status>killed</status>\n<summary>Agent "Sweep the repo" was stopped</summary>\n</task-notification>`,
    ),
    { origin: { kind: "task-notification" } },
  ),
];

// The Agent SDK reads transcripts from CLAUDE_CONFIG_DIR/projects; each Subagent's transcript and
// metadata sit in the Session's own folder beside it.
const configDir = mkdtempSync(join(tmpdir(), "fern-claude-"));
const projectDir = join(configDir, "projects", "-repo");
const subagentsDir = join(projectDir, SESSION, "subagents");
mkdirSync(subagentsDir, { recursive: true });
writeFileSync(
  join(projectDir, `${SESSION}.jsonl`),
  `${sessionLines.join("\n")}\n`,
);
const fileOf = (agentId: string) =>
  join(subagentsDir, `agent-${agentId}.jsonl`);
const writeSubagent = (
  agentId: string,
  toolUseId: string,
  lines: ReadonlyArray<string>,
) => {
  writeFileSync(fileOf(agentId), `${lines.join("\n")}\n`);
  writeFileSync(
    join(subagentsDir, `agent-${agentId}.meta.json`),
    JSON.stringify({ toolUseId, spawnDepth: 1 }),
  );
};
// As if Claude Code last wrote the Subagent's file ten minutes ago.
const quieten = (agentId: string) => {
  const then = new Date(Date.now() - 10 * 60_000);
  utimesSync(fileOf(agentId), then, then);
};

// Hands back through SubagentHandback, after a search. Claude Code writes each block of a reply on
// a line of its own, so the last reply's two blocks share its message id.
const handback = transcriptOf(HANDBACK);
writeSubagent(HANDBACK, "toolu_handback", [
  handback(2, "user", user("Map how transcripts are read.")),
  handback(
    3,
    "assistant",
    assistant([
      toolUse("toolu_grep", "Grep", { pattern: "getSessionMessages" }),
    ]),
  ),
  handback(4, "user", user([result("toolu_grep", "src/Transcripts.ts")])),
  handback(5, "assistant", assistant([text("Found it.")], "msg_last")),
  handback(
    6,
    "assistant",
    assistant(
      [
        toolUse("toolu_hb", "SubagentHandback", {
          message: "Transcripts.ts reads them.",
        }),
      ],
      "msg_last",
    ),
  ),
  handback(8, "user", user([result("toolu_hb", "Delivered.")])),
]);

// Ends with plain text and no SubagentHandback.
const plain = transcriptOf(TEXT);
writeSubagent(TEXT, "toolu_text", [
  plain(3, "user", user("Find the tests.")),
  plain(9, "assistant", assistant([text("Three tests cover it.")])),
]);
quieten(TEXT);

// Cut off mid-work: no Hand-back, and its file went quiet long ago.
const cut = transcriptOf(CUT);
writeSubagent(CUT, "toolu_cut", [
  cut(4, "user", user("Write a verify recipe.")),
  cut(
    5,
    "assistant",
    assistant([toolUse("toolu_bash", "Bash", { command: "ls" })]),
  ),
]);
quieten(CUT);

// Still at work: its file was just written.
const running = transcriptOf(RUNNING);
writeSubagent(RUNNING, "toolu_running", [
  running(5, "user", user("Plan the work.")),
  running(
    6,
    "assistant",
    assistant([toolUse("toolu_read", "Read", { file_path: "/repo/a.ts" })]),
  ),
  running(7, "user", user([result("toolu_read", "export {}")])),
]);

// Stopped by the developer, just now: its file was just written.
const killed = transcriptOf(KILLED);
writeSubagent(KILLED, "toolu_killed", [
  killed(7, "user", user("Sweep the repo.")),
]);

// Its Agent call came back as an error.
const failed = transcriptOf(FAILED);
writeSubagent(FAILED, "toolu_failed", [
  failed(6, "user", user("Review the diff.")),
]);

process.env.CLAUDE_CONFIG_DIR = configDir;

const makeLive = RpcTest.makeClient(LiveRpcs);

// The chat row's status for each Agent call.
const rowStatuses = (items: ReadonlyArray<TranscriptItem>) =>
  Object.fromEntries(
    items.flatMap((item) =>
      item._tag === "Subagent" ? [[item.callId, item.status]] : [],
    ),
  );

const firstView = (agentId: string) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    const [view] = yield* live
      .Subagent({ sessionId: SESSION, agentId })
      .pipe(Stream.take(1), Stream.runCollect);
    if (view === undefined) return assert.fail("no view");
    return view;
  });

// Where a Subagent stands on its row in the chat, in the tab bar and on its own tab.
const statuses = (agentId: string, callId: string) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    const [chat] = yield* live
      .Transcript({ id: SESSION })
      .pipe(Stream.take(1), Stream.runCollect);
    const [list] = yield* live
      .Subagents({ sessionId: SESSION })
      .pipe(Stream.take(1), Stream.runCollect);
    const view = yield* firstView(agentId);
    return {
      row: rowStatuses(chat?.upserts ?? [])[callId],
      tab: list?.find((s) => s.agentId === agentId)?.status,
      view: view.header.status,
      handBack: view.handBack,
    };
  });

layer(
  Layer.mergeAll(
    handlersWith(NoWriter).pipe(
      Layer.provide([DatabaseLive(":memory:"), NoWorktreesDir]),
    ),
    HttpServer.layerServices,
  ),
  { excludeTestServices: true },
)("Subagent status", (it) => {
  it.effect("works out a Subagent's stats from its own transcript", () =>
    Effect.gen(function* () {
      const { header } = yield* firstView(HANDBACK);
      assert.deepStrictEqual(
        {
          agentType: header.agentType,
          description: header.description,
          status: header.status,
          durationMs: header.durationMs,
          toolCalls: header.toolCalls,
          tokens: header.tokens,
        },
        {
          agentType: "Explore",
          description: "Map the code",
          status: "done",
          // From its first message, at 2s, to its last, at 8s.
          durationMs: 6000,
          // The search and the SubagentHandback call.
          toolCalls: 2,
          // Its last request's usage: what it read, cached or not, and what it wrote.
          tokens: 1152,
        },
      );
    }),
  );

  it.effect("hands back the message of the last SubagentHandback call", () =>
    Effect.gen(function* () {
      const view = yield* firstView(HANDBACK);
      assert.strictEqual(view.handBack, "Transcripts.ts reads them.");
    }),
  );

  it.effect("hands back the final text when there's no SubagentHandback", () =>
    Effect.gen(function* () {
      const view = yield* firstView(TEXT);
      assert.strictEqual(view.handBack, "Three tests cover it.");
      assert.strictEqual(view.header.status, "done");
    }),
  );

  it.effect("shows a Subagent cut off without a Hand-back as stopped", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* statuses(CUT, "toolu_cut"), {
        row: "stopped",
        tab: "stopped",
        view: "stopped",
        handBack: undefined,
      });
    }),
  );

  it.effect(
    "shows a background Subagent the developer stopped as stopped",
    () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* statuses(KILLED, "toolu_killed"), {
          row: "stopped",
          tab: "stopped",
          view: "stopped",
          handBack: undefined,
        });
      }),
  );

  it.effect("shows a failed Agent call as failed on its row and its tab", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* statuses(FAILED, "toolu_failed"), {
        row: "failed",
        tab: "failed",
        view: "failed",
        handBack: undefined,
      });
    }),
  );

  it.effect(
    "shows a Subagent running, then stopped once its file goes quiet",
    () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* statuses(RUNNING, "toolu_running"), {
          row: "running",
          tab: "running",
          view: "running",
          handBack: undefined,
        });
        const live = yield* makeLive;
        let seen = 0;
        const lists = yield* live.Subagents({ sessionId: SESSION }).pipe(
          Stream.tap(() =>
            Effect.sync(() => {
              if (seen++ === 0) quieten(RUNNING);
            }),
          ),
          Stream.take(2),
          Stream.runCollect,
        );
        assert.deepStrictEqual(
          lists.map((list) => list.find((s) => s.agentId === RUNNING)?.status),
          ["running", "stopped"],
        );
        assert.deepStrictEqual(yield* statuses(RUNNING, "toolu_running"), {
          row: "stopped",
          tab: "stopped",
          view: "stopped",
          handBack: undefined,
        });
      }),
  );
});
