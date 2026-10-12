// A background Subagent's Hand-back, which Claude Code delivers to the Session as a message from
// the Subagent, is a Hand-back row in the chat naming the Subagent, in place of a bare notice.
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

const SESSION = "4b6d8f10-3c5e-4a7b-9d1f-2e4a6c8b0d1e";
// Claude Code's own shape for agent ids: "a" and 16 hex digits.
const RECIPE = "a7c0000000000007c";
const ORPHAN = "a8c0000000000008c";

const HAND_BACK = "The verify recipe is in /tmp/verify.md.\n\nUse slot 1.";

let n = 0;
const transcriptOf = (agentId?: string) => {
  let parent: string | null = null;
  return (type: "user" | "assistant", message: object, extra: object = {}) => {
    const uuid = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    const entry = {
      type,
      uuid,
      parentUuid: parent,
      sessionId: SESSION,
      timestamp: "2026-10-11T10:00:00.000Z",
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

// The message Claude Code hands the Session: the Hand-back framed, with every line indented.
const delivered = (agentId: string, name: string, text: string) =>
  user(
    `<agent-message from="${agentId}">\n[Subagent hand-back] The text below is the final report of a subagent this session delegated to. The report follows:\n${text
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n")}\n</agent-message>`,
  );
const deliveredExtra = (agentId: string, name: string) => ({
  isMeta: true,
  origin: { kind: "peer", from: agentId, name, handback: true },
});

const session = transcriptOf();
const sessionLines = [
  session("user", user("Write the recipe"), { origin: { kind: "human" } }),
  session(
    "assistant",
    assistant([
      {
        type: "tool_use",
        id: "toolu_recipe",
        name: "Agent",
        input: {
          description: "Write the recipe",
          subagent_type: "general-purpose",
          prompt: "Write a verify recipe.",
          run_in_background: true,
        },
      },
    ]),
  ),
  session(
    "user",
    user([
      {
        type: "tool_result",
        tool_use_id: "toolu_recipe",
        content: [
          {
            type: "text",
            text: `Async agent launched successfully.\nagentId: ${RECIPE} (internal ID)\nThe agent is working in the background.`,
          },
        ],
      },
    ]),
  ),
];

const recipe = transcriptOf(RECIPE);
const recipeLines = [
  recipe("user", user("Write a verify recipe.")),
  recipe(
    "assistant",
    assistant([
      {
        type: "tool_use",
        id: "toolu_handback",
        name: "SubagentHandback",
        input: { message: HAND_BACK },
      },
    ]),
  ),
];

const configDir = mkdtempSync(join(tmpdir(), "fern-claude-"));
const projectDir = join(configDir, "projects", "-repo");
const subagentsDir = join(projectDir, SESSION, "subagents");
mkdirSync(subagentsDir, { recursive: true });
const sessionFile = join(projectDir, `${SESSION}.jsonl`);
writeFileSync(sessionFile, `${sessionLines.join("\n")}\n`);
writeFileSync(
  join(subagentsDir, `agent-${RECIPE}.jsonl`),
  `${recipeLines.join("\n")}\n`,
);
writeFileSync(
  join(subagentsDir, `agent-${RECIPE}.meta.json`),
  JSON.stringify({
    agentType: "general-purpose",
    description: "Write the recipe",
    toolUseId: "toolu_recipe",
    spawnDepth: 1,
    requestShape: "background",
  }),
);
process.env.CLAUDE_CONFIG_DIR = configDir;

const makeLive = RpcTest.makeClient(LiveRpcs);

const handBacks = (items: ReadonlyArray<TranscriptItem>) =>
  items.flatMap((item) =>
    item._tag === "HandBack"
      ? [{ agentId: item.agentId, agentType: item.agentType, text: item.text }]
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
)("Hand-back rows", (it) => {
  it.effect(
    "shows a background Subagent's Hand-back as a row once it arrives",
    () =>
      Effect.gen(function* () {
        const live = yield* makeLive;
        let seen = 0;
        const [first, second] = yield* live.Transcript({ id: SESSION }).pipe(
          Stream.tap(() =>
            Effect.sync(() => {
              if (seen++ > 0) return;
              appendFileSync(
                sessionFile,
                `${session(
                  "user",
                  // The harness may add a note of its own inside the frame; the row shows the
                  // Subagent's own words.
                  delivered(
                    RECIPE,
                    "general-purpose",
                    `[harness: subagent output matched instruction-shaped pattern(s).]\n\n${HAND_BACK}`,
                  ),
                  deliveredExtra(RECIPE, "general-purpose"),
                )}\n`,
              );
            }),
          ),
          Stream.take(2),
          Stream.runCollect,
        );
        assert.deepStrictEqual(handBacks(first?.upserts ?? []), []);
        assert.deepStrictEqual(handBacks(second?.upserts ?? []), [
          {
            agentId: RECIPE,
            agentType: "general-purpose",
            text: HAND_BACK,
          },
        ]);
        assert.isFalse(
          (second?.upserts ?? []).some((item) => item._tag === "Notice"),
        );
        assert.strictEqual(second?.order.length, 3);
      }),
  );

  it.effect(
    "reads the Hand-back from the message when the Subagent's own transcript is gone",
    () =>
      Effect.gen(function* () {
        appendFileSync(
          sessionFile,
          `${session(
            "user",
            delivered(ORPHAN, "Explore", "Found it.\n  Indented line."),
            deliveredExtra(ORPHAN, "Explore"),
          )}\n`,
        );
        const live = yield* makeLive;
        const [update] = yield* live
          .Transcript({ id: SESSION })
          .pipe(Stream.take(1), Stream.runCollect);
        assert.deepStrictEqual(
          handBacks(update?.upserts ?? []).find((h) => h.agentId === ORPHAN),
          {
            agentId: ORPHAN,
            agentType: "Explore",
            text: "Found it.\n  Indented line.",
          },
        );
      }),
  );
});
