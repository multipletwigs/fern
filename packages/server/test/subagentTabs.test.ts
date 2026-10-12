// Each of a Session's Subagents gets a tab: the Subagents stream lists them in start order, and the
// Subagent stream shows one's Assignment and work, live.
import { assert, layer } from "@effect/vitest";
import {
  LiveRpcs,
  type SubagentHeader,
  type SubagentSummary,
  type TranscriptItem,
} from "@repo/api";
import { DateTime, Effect, Layer, Stream } from "effect";
import { HttpServer } from "effect/http";
import { RpcTest } from "effect/rpc";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import { NoWorktreesDir, NoWriter } from "./stubs";

const SESSION = "5d2f8b30-6a1c-4e2b-9f3d-7a8b9c0d1e2f";
// Claude Code's own shape for agent ids: "a" and 16 hex digits.
const BG = "a0b0000000000000b";
const FG = "a0f0000000000000f";
const NESTED = "a0e0000000000000e";
const NO_META = "a0a0000000000000a";
const LATE = "a0c0000000000000c";
const LATER = "a0d0000000000000d";

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

const assistant = (content: ReadonlyArray<object>) => ({
  id: `msg_${++n}`,
  role: "assistant",
  model: "claude-opus-5-5",
  content,
});
const user = (content: string | ReadonlyArray<object>) => ({
  role: "user",
  content,
});
const agentCall = (id: string, input: object) => ({
  type: "tool_use",
  id,
  name: "Agent",
  input,
});
const result = (id: string, text: string) => ({
  type: "tool_result",
  tool_use_id: id,
  content: [{ type: "text", text }],
});

const main = transcriptOf();
const sessionLines = [
  main(0, "user", user("Build the tabs"), { origin: { kind: "human" } }),
  main(
    1,
    "assistant",
    assistant([
      agentCall("toolu_bg", {
        description: "Write the recipe",
        subagent_type: "general-purpose",
        prompt: "Write a verify recipe.",
        run_in_background: true,
      }),
      agentCall("toolu_fg", {
        description: "Map the code",
        subagent_type: "Explore",
        prompt: "Map how transcripts are read.",
      }),
      // Started later in the tests: no files yet.
      agentCall("toolu_late", { prompt: "Plan the work." }),
      agentCall("toolu_later", { prompt: "Plan it again." }),
    ]),
  ),
  main(
    9,
    "user",
    user([
      result(
        "toolu_bg",
        `Async agent launched successfully.\nagentId: ${BG} (internal ID)`,
      ),
      result("toolu_fg", `Transcripts.ts reads them.\nagentId: ${FG}`),
    ]),
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
  lines: ReadonlyArray<string>,
  meta?: object,
) => {
  writeFileSync(fileOf(agentId), `${lines.join("\n")}\n`);
  if (meta)
    writeFileSync(
      join(subagentsDir, `agent-${agentId}.meta.json`),
      JSON.stringify(meta),
    );
};

// A background Subagent that started a nested one, which handed back at once.
const bg = transcriptOf(BG);
writeSubagent(
  BG,
  [
    bg(2, "user", user("Write a verify recipe.\nKeep it short.")),
    bg(
      4,
      "assistant",
      assistant([
        agentCall("toolu_nested", {
          description: "Find the fixtures",
          prompt: "Find the fixtures.",
        }),
      ]),
    ),
    bg(
      7,
      "user",
      user([result("toolu_nested", `Found them.\nagentId: ${NESTED}`)]),
    ),
  ],
  {
    agentType: "general-purpose",
    description: "Write the recipe",
    toolUseId: "toolu_bg",
    spawnDepth: 1,
    requestShape: "background",
  },
);

const fg = transcriptOf(FG);
writeSubagent(
  FG,
  [
    fg(3, "user", user("Map how transcripts are read.")),
    fg(
      5,
      "assistant",
      assistant([
        { type: "thinking", thinking: "Start from the server.", signature: "" },
        {
          type: "tool_use",
          id: "toolu_grep",
          name: "Grep",
          input: { pattern: "getSessionMessages" },
        },
      ]),
    ),
    fg(
      6,
      "user",
      user([result("toolu_grep", "src/transcript/Transcripts.ts")]),
    ),
    fg(
      8,
      "assistant",
      assistant([{ type: "text", text: "Transcripts.ts reads them." }]),
    ),
  ],
  {
    agentType: "Explore",
    description: "Map the code",
    toolUseId: "toolu_fg",
    spawnDepth: 1,
    requestShape: "foreground",
  },
);

const nested = transcriptOf(NESTED);
writeSubagent(
  NESTED,
  [
    nested(5, "user", user("Find the fixtures.")),
    nested(6, "assistant", assistant([{ type: "text", text: "Found them." }])),
  ],
  {
    agentType: "Explore",
    description: "Find the fixtures",
    toolUseId: "toolu_nested",
    spawnDepth: 2,
    parentAgentId: BG,
    requestShape: "foreground",
  },
);

// Claude Code wrote no metadata for this one.
const noMeta = transcriptOf(NO_META);
writeSubagent(NO_META, [
  noMeta(7, "user", user("List the tests\nand their seams.")),
]);

process.env.CLAUDE_CONFIG_DIR = configDir;

const makeLive = RpcTest.makeClient(LiveRpcs);

// What a tab shows of a Subagent, with times as epoch millis.
const tab = (s: SubagentSummary | SubagentHeader) => ({
  agentId: s.agentId,
  callId: s.callId,
  agentType: s.agentType,
  description: s.description,
  status: s.status,
  startedAt: s.startedAt && DateTime.toEpochMillis(s.startedAt),
  parentAgentId: s.parentAgentId,
});
const ms = (second: number) => Date.parse(at(second));

const tags = (items: ReadonlyArray<TranscriptItem>) =>
  items.map((item) => item._tag);

// The chat's row for the Agent call started last.
const laterRow = (items: ReadonlyArray<TranscriptItem>) =>
  items.flatMap((item) =>
    item._tag === "Subagent" && item.callId === "toolu_later"
      ? [{ agentId: item.agentId, agentType: item.agentType }]
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
)("Subagent tabs", (it) => {
  it.effect("lists a Session's Subagents in the order they started", () =>
    Effect.gen(function* () {
      const live = yield* makeLive;
      const [list] = yield* live
        .Subagents({ sessionId: SESSION })
        .pipe(Stream.take(1), Stream.runCollect);
      assert.deepStrictEqual(list?.map(tab), [
        {
          agentId: BG,
          callId: "toolu_bg",
          agentType: "general-purpose",
          description: "Write the recipe",
          status: "running",
          startedAt: ms(2),
          parentAgentId: undefined,
        },
        {
          agentId: FG,
          callId: "toolu_fg",
          agentType: "Explore",
          description: "Map the code",
          status: "done",
          startedAt: ms(3),
          parentAgentId: undefined,
        },
        {
          agentId: NESTED,
          callId: "toolu_nested",
          agentType: "Explore",
          description: "Find the fixtures",
          status: "done",
          startedAt: ms(5),
          parentAgentId: BG,
        },
        {
          agentId: NO_META,
          callId: undefined,
          agentType: "Subagent",
          description: "List the tests",
          status: "running",
          startedAt: ms(7),
          parentAgentId: undefined,
        },
      ]);
    }),
  );

  it.effect("shows a Subagent's Assignment above its work", () =>
    Effect.gen(function* () {
      const live = yield* makeLive;
      const [view] = yield* live
        .Subagent({ sessionId: SESSION, agentId: FG })
        .pipe(Stream.take(1), Stream.runCollect);
      assert.deepStrictEqual(view && tab(view.header), {
        agentId: FG,
        callId: "toolu_fg",
        agentType: "Explore",
        description: "Map the code",
        status: "done",
        startedAt: ms(3),
        parentAgentId: undefined,
      });
      assert.strictEqual(view?.assignment, "Map how transcripts are read.");
      assert.deepStrictEqual(tags(view?.upserts ?? []), [
        "Thinking",
        "ToolCall",
        "Text",
      ]);
      assert.deepStrictEqual(
        view?.order,
        view?.upserts.map((item) => item.id),
      );
    }),
  );

  it.effect("names the Subagent that started a nested one", () =>
    Effect.gen(function* () {
      const live = yield* makeLive;
      const [view] = yield* live
        .Subagent({ sessionId: SESSION, agentId: NESTED })
        .pipe(Stream.take(1), Stream.runCollect);
      assert.strictEqual(view?.header.parentAgentId, BG);
      // Its Agent call, in the Subagent that started it, handed back.
      assert.strictEqual(view?.header.status, "done");
      assert.strictEqual(view?.assignment, "Find the fixtures.");
    }),
  );

  it.effect("fails for an agent the Session doesn't have", () =>
    Effect.gen(function* () {
      const live = yield* makeLive;
      const error = yield* live
        .Subagent({ sessionId: SESSION, agentId: "a0f0000000000099f" })
        .pipe(Stream.runCollect, Effect.flip);
      assert.strictEqual(error._tag, "SubagentNotFound");
    }),
  );

  it.effect("sends a Subagent's new work as its file grows", () =>
    Effect.gen(function* () {
      const live = yield* makeLive;
      let seen = 0;
      const [first, second] = yield* live
        .Subagent({ sessionId: SESSION, agentId: BG })
        .pipe(
          Stream.tap(() =>
            Effect.sync(() => {
              if (seen++ > 0) return;
              appendFileSync(
                fileOf(BG),
                `${bg(8, "assistant", assistant([{ type: "text", text: "The recipe is ready." }]))}\n`,
              );
            }),
          ),
          Stream.take(2),
          Stream.runCollect,
        );
      assert.deepStrictEqual(tags(first?.upserts ?? []), ["Subagent"]);
      // Only the new item is sent again, after the ones already there.
      assert.deepStrictEqual(
        second?.upserts.map((item) =>
          item._tag === "Text" ? item.markdown : item._tag,
        ),
        ["The recipe is ready."],
      );
      assert.deepStrictEqual(second?.order.slice(0, 1), first?.order);
      assert.strictEqual(second?.order.length, 2);
    }),
  );

  it.effect("lists a Subagent as soon as its transcript is written", () =>
    Effect.gen(function* () {
      const live = yield* makeLive;
      let seen = 0;
      const late = transcriptOf(LATE);
      const [first, second] = yield* live
        .Subagents({ sessionId: SESSION })
        .pipe(
          Stream.tap(() =>
            Effect.sync(() => {
              if (seen++ > 0) return;
              writeSubagent(LATE, [late(10, "user", user("Plan the work."))], {
                agentType: "Plan",
                description: "Plan the work",
                toolUseId: "toolu_late",
                spawnDepth: 1,
                requestShape: "foreground",
              });
            }),
          ),
          Stream.take(2),
          Stream.runCollect,
        );
      assert.isFalse(first?.some((s) => s.agentId === LATE) ?? true);
      // It comes last, having started last.
      const last = second?.at(-1);
      assert.deepStrictEqual(last && tab(last), {
        agentId: LATE,
        callId: "toolu_late",
        agentType: "Plan",
        description: "Plan the work",
        status: "running",
        startedAt: ms(10),
        parentAgentId: undefined,
      });
    }),
  );

  it.effect("re-reads the chat when a Subagent's files are written", () =>
    Effect.gen(function* () {
      const live = yield* makeLive;
      let seen = 0;
      const later = transcriptOf(LATER);
      const [first, second] = yield* live.Transcript({ id: SESSION }).pipe(
        Stream.tap(() =>
          Effect.sync(() => {
            if (seen++ > 0) return;
            writeSubagent(LATER, [later(11, "user", user("Plan it again."))], {
              agentType: "Plan",
              toolUseId: "toolu_later",
            });
          }),
        ),
        Stream.take(2),
        Stream.runCollect,
      );
      assert.deepStrictEqual(laterRow(first?.upserts ?? []), [
        { agentId: undefined, agentType: "Subagent" },
      ]);
      assert.deepStrictEqual(laterRow(second?.upserts ?? []), [
        { agentId: LATER, agentType: "Plan" },
      ]);
    }),
  );
});
