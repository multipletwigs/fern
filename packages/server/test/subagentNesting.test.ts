// A Subagent started by another Subagent gets its own tab like any other: the Subagents stream names
// the Subagent that started it, and the Agent call in the outer one's work is a Subagent row for it.
import { assert, layer } from "@effect/vitest";
import { LiveRpcs, type TranscriptItem } from "@repo/api";
import { Effect, Layer, Stream } from "effect";
import { HttpServer } from "effect/http";
import { RpcTest } from "effect/rpc";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import { NoWorktreesDir, NoWriter } from "./stubs";

const SESSION = "9e1d2c3b-4a5f-4e6d-8c7b-6a5f4e3d2c1b";
// Claude Code's own shape for agent ids: "a" and 16 hex digits.
const OUTER = "a1b0000000000000b";
const INNER = "a1e0000000000000e";
// A nested one Claude Code wrote no metadata for.
const BARE = "a1a0000000000000a";

let n = 0;
// One transcript's lines, each chained to the one before, as Claude Code writes them.
const transcriptOf = (agentId?: string) => {
  let parent: string | null = null;
  return (second: number, type: "user" | "assistant", message: object) => {
    const uuid = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    const entry = {
      type,
      uuid,
      parentUuid: parent,
      sessionId: SESSION,
      timestamp: `2026-10-11T10:00:${String(second).padStart(2, "0")}.000Z`,
      cwd: "/repo",
      entrypoint: "cli",
      ...(agentId ? { isSidechain: true, agentId } : {}),
      message,
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

const configDir = mkdtempSync(join(tmpdir(), "fern-claude-"));
const projectDir = join(configDir, "projects", "-repo");
const subagentsDir = join(projectDir, SESSION, "subagents");
mkdirSync(subagentsDir, { recursive: true });
const writeSubagent = (
  agentId: string,
  lines: ReadonlyArray<string>,
  meta?: object,
) => {
  writeFileSync(
    join(subagentsDir, `agent-${agentId}.jsonl`),
    `${lines.join("\n")}\n`,
  );
  if (meta)
    writeFileSync(
      join(subagentsDir, `agent-${agentId}.meta.json`),
      JSON.stringify(meta),
    );
};

const main = transcriptOf();
writeFileSync(
  join(projectDir, `${SESSION}.jsonl`),
  `${[
    main(0, "user", user("Build the tabs")),
    main(
      1,
      "assistant",
      assistant([
        agentCall("toolu_outer", {
          description: "Implement the ticket",
          subagent_type: "general-purpose",
          prompt: "Implement the ticket.",
          run_in_background: true,
        }),
      ]),
    ),
    main(
      2,
      "user",
      user([
        result("toolu_outer", `Async agent launched.\nagentId: ${OUTER}`),
      ]),
    ),
  ].join("\n")}\n`,
);

// The outer Subagent starts two nested ones; both handed back.
const outer = transcriptOf(OUTER);
writeSubagent(
  OUTER,
  [
    outer(3, "user", user("Implement the ticket.")),
    outer(
      4,
      "assistant",
      assistant([
        agentCall("toolu_inner", {
          description: "Find the seams",
          subagent_type: "Explore",
          prompt: "Find the seams.",
        }),
        agentCall("toolu_bare", {
          description: "Read the tests",
          subagent_type: "Explore",
          prompt: "Read the tests.",
        }),
      ]),
    ),
    outer(
      9,
      "user",
      user([
        result("toolu_inner", `The seams are the Live RPCs.\nagentId: ${INNER}`),
        result("toolu_bare", `They use RpcTest.\nagentId: ${BARE}`),
      ]),
    ),
  ],
  {
    agentType: "general-purpose",
    description: "Implement the ticket",
    toolUseId: "toolu_outer",
    spawnDepth: 1,
    requestShape: "background",
  },
);

const inner = transcriptOf(INNER);
writeSubagent(
  INNER,
  [
    inner(5, "user", user("Find the seams.")),
    inner(
      6,
      "assistant",
      assistant([{ type: "text", text: "The seams are the Live RPCs." }]),
    ),
  ],
  {
    agentType: "Explore",
    description: "Find the seams",
    toolUseId: "toolu_inner",
    spawnDepth: 2,
    parentAgentId: OUTER,
    requestShape: "foreground",
  },
);

const bare = transcriptOf(BARE);
writeSubagent(BARE, [
  bare(7, "user", user("Read the tests.")),
  bare(8, "assistant", assistant([{ type: "text", text: "They use RpcTest." }])),
]);

process.env.CLAUDE_CONFIG_DIR = configDir;

const makeLive = RpcTest.makeClient(LiveRpcs);

// The Subagent rows among a view's items.
const subagentRows = (items: ReadonlyArray<TranscriptItem>) =>
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
)("Nested Subagents", (it) => {
  it.effect("names the Subagent that started each nested one", () =>
    Effect.gen(function* () {
      const live = yield* makeLive;
      const [list] = yield* live
        .Subagents({ sessionId: SESSION })
        .pipe(Stream.take(1), Stream.runCollect);
      assert.deepStrictEqual(
        list?.map((s) => [s.agentId, s.parentAgentId]),
        [
          [OUTER, undefined],
          [INNER, OUTER],
          // Without metadata, from the transcript its Agent call is in.
          [BARE, OUTER],
        ],
      );
    }),
  );

  it.effect(
    "shows each Agent call in the outer Subagent's work as a Subagent row",
    () =>
      Effect.gen(function* () {
        const live = yield* makeLive;
        const [view] = yield* live
          .Subagent({ sessionId: SESSION, agentId: OUTER })
          .pipe(Stream.take(1), Stream.runCollect);
        assert.deepStrictEqual(subagentRows(view?.upserts ?? []), [
          {
            callId: "toolu_inner",
            agentId: INNER,
            agentType: "Explore",
            description: "Find the seams",
            status: "done",
          },
          {
            callId: "toolu_bare",
            agentId: BARE,
            agentType: "Explore",
            description: "Read the tests",
            status: "done",
          },
        ]);
      }),
  );

  it.effect("heads a nested Subagent's view with the one that started it", () =>
    Effect.gen(function* () {
      const live = yield* makeLive;
      const [view] = yield* live
        .Subagent({ sessionId: SESSION, agentId: BARE })
        .pipe(Stream.take(1), Stream.runCollect);
      assert.deepStrictEqual(
        view && {
          parentAgentId: view.header.parentAgentId,
          callId: view.header.callId,
          status: view.header.status,
        },
        { parentAgentId: OUTER, callId: "toolu_bare", status: "done" },
      );
    }),
  );
});
