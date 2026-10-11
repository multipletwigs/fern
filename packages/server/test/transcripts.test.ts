import { assert, layer } from "@effect/vitest";
import { FernApi } from "@repo/api";
import { Effect, Layer, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HandlersNoDeps } from "../src/http";
import { Transcripts } from "../src/transcript/Transcripts";
import { Turns } from "../src/turn/Turns";
import { Workspace } from "../src/workspace/Workspace";
import { NodeServices } from "@effect/platform-node";

const SESSION = "4b01f026-4f24-41ef-b407-1e7e05c2684c";

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

const transcript = [
  line(
    "user",
    { role: "user", content: "Render my session" },
    { origin: { kind: "human" } },
  ),
  line("assistant", {
    id: "msg_1",
    role: "assistant",
    model: "claude-opus-5-5",
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation: { ephemeral_1h_input_tokens: 50 },
    },
    content: [
      { type: "text", text: "Editing **now**." },
      {
        type: "tool_use",
        id: "toolu_1",
        name: "Edit",
        input: {
          file_path: "/repo/src/a.ts",
          old_string: "a",
          new_string: "b",
        },
      },
    ],
  }),
  line("user", {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }],
  }),
  line("user", { role: "user", content: "[Request interrupted by user]" }),
];

// The Agent SDK reads transcripts from CLAUDE_CONFIG_DIR/projects.
const configDir = mkdtempSync(join(tmpdir(), "fern-claude-"));
mkdirSync(join(configDir, "projects", "-repo"), { recursive: true });
writeFileSync(
  join(configDir, "projects", "-repo", `${SESSION}.jsonl`),
  `${transcript.join("\n")}\n`,
);
process.env.CLAUDE_CONFIG_DIR = configDir;

const makeClient = HttpApiTest.groups(FernApi, ["sessions"]);

layer(
  Layer.mergeAll(
    HandlersNoDeps.pipe(
      Layer.provide(Transcripts.layer),
      Layer.provide([Turns.layer, Workspace.layer]),
      Layer.provide(NodeServices.layer),
    ),
    HttpServer.layerServices,
  ),
)("Sessions API", (it) => {
  it.effect("finds the most recent session", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const ref = yield* client.sessions.current();
      assert.strictEqual(ref.id, SESSION);
    }),
  );

  it.effect("groups sessions into projects", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const stream = yield* client.sessions.projects();
      const [projects] = yield* stream.pipe(Stream.take(1), Stream.runCollect);
      assert.deepStrictEqual(
        projects?.map((p) => ({
          path: p.path,
          sessions: p.sessions.map((s) => s.id),
        })),
        [{ path: "/repo", sessions: [SESSION] }],
      );
      assert.strictEqual(
        projects?.[0]?.sessions[0]?.title,
        "Render my session",
      );
    }),
  );

  it.effect("streams the transcript as renderable items", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const stream = yield* client.sessions.live({ params: { id: SESSION } });
      const [update] = yield* stream.pipe(Stream.take(1), Stream.runCollect);
      assert.isDefined(update);
      if (!update) return;

      assert.deepStrictEqual(
        update.upserts.map((item) => item._tag),
        ["Prompt", "Text", "ToolCall", "Interrupt"],
      );
      const call = update.upserts[2];
      assert.strictEqual(call?._tag, "ToolCall");
      if (call?._tag !== "ToolCall") return;
      assert.strictEqual(call.summary, "src/a.ts");
      assert.deepStrictEqual(call.result, { text: "ok", isError: false });
      assert.deepStrictEqual(call.diff, ["-a", "+b"]);
      assert.strictEqual(update.header.model, "claude-opus-5-5");
      assert.isDefined(update.header.cacheExpiresAt);
    }),
  );

  it.effect("reports no running turns", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      assert.deepStrictEqual(yield* client.sessions.running(), []);
    }),
  );

  it.effect("won't send to a session another process is writing", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      // The fixture transcript was written moments ago, as if Claude Code were running it.
      const error = yield* client.sessions
        .send({ params: { id: SESSION }, payload: { text: "hello" } })
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "SessionInUse");
    }),
  );

  it.effect("won't send to an unknown session", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.sessions
        .send({
          params: { id: "00000000-0000-4000-8000-000000000000" },
          payload: { text: "hello" },
        })
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "SessionNotFound");
    }),
  );

  it.effect("rejects unknown sessions", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.sessions
        .live({ params: { id: "00000000-0000-4000-8000-000000000000" } })
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "SessionNotFound");
    }),
  );
});
