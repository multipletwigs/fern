// When Claude Code resumes a Session whose last message never got a reply, it records a synthetic
// "No response requested." in its place. The transcript shows the message as unanswered instead.
import { assert, layer } from "@effect/vitest";
import { LiveRpcs } from "@repo/api";
import { Effect, Layer, Stream } from "effect";
import { HttpServer } from "effect/http";
import { RpcTest } from "effect/rpc";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import { NoWorktreesDir, NoWriter } from "./stubs";

const SESSION = "9d3f6a1e-2b4c-4e8f-a1d2-7c5b3e9f0a14";

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

const synthetic = (text: string, extra: object = {}) =>
  line(
    "assistant",
    {
      id: `synthetic-${n}`,
      role: "assistant",
      model: "<synthetic>",
      usage: { input_tokens: 0, output_tokens: 0 },
      content: [{ type: "text", text }],
    },
    extra,
  );

const transcript = [
  line("user", {
    role: "user",
    content: [
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "iVBORw0K" },
      },
      { type: "text", text: "Fix the bug" },
    ],
  }),
  synthetic("No response requested.", { isApiErrorMessage: false }),
  line("user", { role: "user", content: "Are you there?" }),
  line("assistant", {
    id: "msg_1",
    role: "assistant",
    model: "claude-opus-5-5",
    usage: { input_tokens: 10, output_tokens: 2 },
    content: [{ type: "text", text: "Yes." }],
  }),
  line("user", { role: "user", content: "Try again" }),
  synthetic("API Error: 500 Internal server error", {
    isApiErrorMessage: true,
  }),
];

const configDir = mkdtempSync(join(tmpdir(), "fern-claude-"));
mkdirSync(join(configDir, "projects", "-repo"), { recursive: true });
writeFileSync(
  join(configDir, "projects", "-repo", `${SESSION}.jsonl`),
  `${transcript.join("\n")}\n`,
);
process.env.CLAUDE_CONFIG_DIR = configDir;

const makeLive = RpcTest.makeClient(LiveRpcs);

layer(
  Layer.mergeAll(
    handlersWith(NoWriter).pipe(
      Layer.provide([DatabaseLive(":memory:"), NoWorktreesDir]),
    ),
    HttpServer.layerServices,
  ),
)("Unanswered messages", (it) => {
  it.effect(
    "marks a message Claude Code never replied to, without the placeholder",
    () =>
      Effect.gen(function* () {
        const live = yield* makeLive;
        const [update] = yield* live
          .Transcript({ id: SESSION })
          .pipe(Stream.take(1), Stream.runCollect);
        assert.isDefined(update);
        if (!update) return;

        assert.deepStrictEqual(
          update.upserts.map((item) =>
            item._tag === "Prompt"
              ? { prompt: item.text, unanswered: item.unanswered ?? false }
              : item._tag === "Text"
                ? { text: item.markdown }
                : { tag: item._tag },
          ),
          [
            { prompt: "Fix the bug", unanswered: true },
            { prompt: "Are you there?", unanswered: false },
            { text: "Yes." },
            { prompt: "Try again", unanswered: false },
            { text: "API Error: 500 Internal server error" },
          ],
        );
        const first = update.upserts[0];
        assert.deepStrictEqual(
          first?._tag === "Prompt" ? first.images : undefined,
          ["data:image/png;base64,iVBORw0K"],
        );
      }),
  );
});
