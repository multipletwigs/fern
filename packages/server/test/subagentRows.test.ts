// Each Agent call in a Session's chat is a Subagent row: its type, description and status, never
// folded into a generic tool call.
import { assert, layer } from "@effect/vitest";
import { LiveRpcs, type TranscriptItem } from "@repo/api";
import { Effect, Layer, Stream } from "effect";
import { HttpServer } from "effect/http";
import { RpcTest } from "effect/rpc";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import { NoWorktreesDir, NoWriter } from "./stubs";

const SESSION = "7c3e9a10-2b4d-4e6f-8a1b-3c5d7e9f0a2b";

let parent: string | null = null;
let n = 0;
const line = (
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
    timestamp: "2026-10-11T10:00:00.000Z",
    cwd: "/repo",
    message,
    ...extra,
  };
  parent = uuid;
  return JSON.stringify(entry);
};

const agentCall = (id: string, input: object) => ({
  type: "tool_use",
  id,
  name: "Agent",
  input,
});

const result = (id: string, text: string, isError = false) => ({
  type: "tool_result",
  tool_use_id: id,
  content: [{ type: "text", text }],
  ...(isError ? { is_error: true } : {}),
});

const transcript = [
  line(
    "user",
    { role: "user", content: "Look into the code" },
    { origin: { kind: "human" } },
  ),
  line("assistant", {
    id: "msg_1",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [
      // Its type is only in the metadata Claude Code wrote for it.
      agentCall("toolu_fg", {
        description: "Map the code",
        prompt: "Map how transcripts are read.",
      }),
      agentCall("toolu_bg", {
        description: "Write the recipe",
        subagent_type: "general-purpose",
        prompt: "Write a verify recipe.",
        run_in_background: true,
      }),
      agentCall("toolu_bad", {
        description: "Plan it",
        subagent_type: "Nope",
        prompt: "Plan the work.",
      }),
      // Claude Code wrote no metadata for this one.
      agentCall("toolu_nometa", {
        description: "Review the diff",
        subagent_type: "Plan",
        prompt: "Review it.",
      }),
      agentCall("toolu_bare", { prompt: "Find the tests\nand list them." }),
    ],
  }),
  line("user", {
    role: "user",
    content: [
      result(
        "toolu_fg",
        `This agent's report was delivered to you as a message from "afg" (its SubagentHandback call). Read it there; it is not repeated here.`,
      ),
      result(
        "toolu_bg",
        "Async agent launched successfully.\nagentId: abg (internal ID)\nThe agent is working in the background.",
      ),
      result("toolu_bad", "Agent type 'Nope' not found.", true),
      result("toolu_nometa", "Looks fine.\nagentId: anometa (for resuming)"),
    ],
  }),
];

// The Agent SDK reads transcripts from CLAUDE_CONFIG_DIR/projects; Claude Code keeps each
// Subagent's metadata in the Session's own folder beside it.
const configDir = mkdtempSync(join(tmpdir(), "fern-claude-"));
const projectDir = join(configDir, "projects", "-repo");
const subagentsDir = join(projectDir, SESSION, "subagents");
mkdirSync(subagentsDir, { recursive: true });
const sessionFile = join(projectDir, `${SESSION}.jsonl`);
writeFileSync(sessionFile, `${transcript.join("\n")}\n`);
const meta = (agentId: string, data: object) =>
  writeFileSync(
    join(subagentsDir, `agent-${agentId}.meta.json`),
    JSON.stringify(data),
  );
meta("afg", {
  agentType: "Explore",
  description: "Map the code",
  toolUseId: "toolu_fg",
  spawnDepth: 1,
  requestShape: "foreground",
});
meta("abg", {
  agentType: "general-purpose",
  description: "Write the recipe",
  toolUseId: "toolu_bg",
  spawnDepth: 1,
  requestShape: "background",
});
// Unreadable metadata is ignored, not fatal.
writeFileSync(join(subagentsDir, "agent-abroken.meta.json"), "{not json");
process.env.CLAUDE_CONFIG_DIR = configDir;

const makeLive = RpcTest.makeClient(LiveRpcs);

const subagents = (items: ReadonlyArray<TranscriptItem>) =>
  items.flatMap((item) =>
    item._tag === "Subagent"
      ? [
          {
            callId: item.callId,
            agentId: item.agentId,
            agentType: item.agentType,
            description: item.description,
            status: item.status,
          },
        ]
      : [],
  );

layer(
  Layer.mergeAll(
    handlersWith(NoWriter).pipe(
      Layer.provide([DatabaseLive(":memory:"), NoWorktreesDir]),
    ),
    HttpServer.layerServices,
  ),
  { excludeTestServices: true },
)("Subagent rows", (it) => {
  it.effect("streams each Agent call as its own Subagent item", () =>
    Effect.gen(function* () {
      const live = yield* makeLive;
      const [update] = yield* live
        .Transcript({ id: SESSION })
        .pipe(Stream.take(1), Stream.runCollect);
      assert.isDefined(update);
      if (!update) return;

      assert.deepStrictEqual(
        update.upserts.map((item) => item._tag),
        ["Prompt", "Subagent", "Subagent", "Subagent", "Subagent", "Subagent"],
      );
      assert.deepStrictEqual(subagents(update.upserts), [
        {
          callId: "toolu_fg",
          agentId: "afg",
          agentType: "Explore",
          description: "Map the code",
          status: "done",
        },
        {
          callId: "toolu_bg",
          agentId: "abg",
          agentType: "general-purpose",
          description: "Write the recipe",
          status: "running",
        },
        {
          callId: "toolu_bad",
          agentId: undefined,
          agentType: "Nope",
          description: "Plan it",
          status: "failed",
        },
        {
          callId: "toolu_nometa",
          agentId: "anometa",
          agentType: "Plan",
          description: "Review the diff",
          status: "done",
        },
        {
          callId: "toolu_bare",
          agentId: undefined,
          agentType: "Subagent",
          description: "Find the tests",
          status: "running",
        },
      ]);
    }),
  );

  it.effect("marks a background Subagent done once it hands back", () =>
    Effect.gen(function* () {
      const live = yield* makeLive;
      let seen = 0;
      const updates = yield* live.Transcript({ id: SESSION }).pipe(
        Stream.tap(() =>
          Effect.sync(() => {
            if (seen++ > 0) return;
            appendFileSync(
              sessionFile,
              `${line(
                "user",
                {
                  role: "user",
                  content: `<task-notification>\n<task-id>abg</task-id>\n<tool-use-id>toolu_bg</tool-use-id>\n<status>completed</status>\n<summary>Agent "Write the recipe" finished</summary>\n</task-notification>`,
                },
                { origin: { kind: "task-notification" } },
              )}\n`,
            );
          }),
        ),
        Stream.take(2),
        Stream.runCollect,
      );
      const [first, second] = updates;
      assert.strictEqual(
        subagents(first?.upserts ?? []).find((s) => s.callId === "toolu_bg")
          ?.status,
        "running",
      );
      // Only the row that changed is sent again.
      assert.deepStrictEqual(subagents(second?.upserts ?? []), [
        {
          callId: "toolu_bg",
          agentId: "abg",
          agentType: "general-purpose",
          description: "Write the recipe",
          status: "done",
        },
      ]);
    }),
  );
});
