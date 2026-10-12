// The composer's context ring shows the Session's tokens out of its context window. Claude Code
// only reports the window in a turn's result, so Fern keeps it once a turn it ran has reported it:
// the ring stays for a Session reopened after Fern restarts.
import { assert, describe, it } from "@effect/vitest";
import { FernApi, LiveRpcs, type TranscriptUpdate } from "@repo/api";
import { Effect, Layer, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { RpcTest } from "effect/rpc";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import { NoWorktreesDir, NoWriter } from "./stubs";

const SESSION = "5a7e2c19-3b8d-4f61-9e0a-c4d2b7f81e36";

// Claude Code answers each message at once; its result reports a 1,000-token window.
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const sdk = await importOriginal<object>();
  const { scriptedQuery } = await import("./fakeClaude");
  return { ...sdk, query: scriptedQuery(() => undefined) };
});

const configDir = mkdtempSync(join(tmpdir(), "fern-claude-"));
mkdirSync(join(configDir, "projects", "-repo"), { recursive: true });
const file = join(configDir, "projects", "-repo", `${SESSION}.jsonl`);
writeFileSync(
  file,
  `${[
    {
      type: "user",
      uuid: "00000000-0000-4000-8000-000000000001",
      parentUuid: null,
      message: { role: "user", content: "Hello" },
    },
    {
      type: "assistant",
      uuid: "00000000-0000-4000-8000-000000000002",
      parentUuid: "00000000-0000-4000-8000-000000000001",
      message: {
        id: "msg_1",
        role: "assistant",
        model: "claude-test",
        usage: { input_tokens: 200, output_tokens: 50 },
        content: [{ type: "text", text: "Hi." }],
      },
    },
  ]
    .map((entry) =>
      JSON.stringify({
        ...entry,
        sessionId: SESSION,
        timestamp: "2026-10-11T10:00:00.000Z",
        cwd: "/repo",
      }),
    )
    .join("\n")}\n`,
);
// Long idle, so nothing else is writing the Session.
utimesSync(file, new Date(2026, 0, 1), new Date(2026, 0, 1));
process.env.CLAUDE_CONFIG_DIR = configDir;

const database = join(mkdtempSync(join(tmpdir(), "fern-db-")), "fern.db");

// One run of Fern, on the same database each time.
const Fern = Layer.mergeAll(
  handlersWith(NoWriter).pipe(
    Layer.provide([DatabaseLive(database), NoWorktreesDir]),
  ),
  HttpServer.layerServices,
);

const makeClient = HttpApiTest.groups(FernApi, ["sessions"]);
const makeLive = RpcTest.makeClient(LiveRpcs);

// The Session's last header among the updates `until` takes.
const header = (
  until: <E>(
    updates: Stream.Stream<TranscriptUpdate, E>,
  ) => Stream.Stream<TranscriptUpdate, E>,
) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    const updates = yield* live
      .Transcript({ id: SESSION })
      .pipe(until, Stream.runCollect);
    return updates.at(-1)?.header;
  });

// Updates until the header shows the window, or for a while.
const windowShown = <E>(updates: Stream.Stream<TranscriptUpdate, E>) =>
  updates.pipe(
    Stream.takeUntil((u) => u.header.contextWindow !== undefined),
    Stream.interruptWhen(Effect.sleep("3 seconds")),
  );

describe("The context window", () => {
  it.live(
    "is shown once a turn reports it, and still after Fern restarts",
    () =>
      Effect.gen(function* () {
        const before = yield* Effect.gen(function* () {
          const client = yield* makeClient;
          const first = yield* header(Stream.take(1));
          assert.strictEqual(first?.contextTokens, 250);
          assert.isUndefined(first?.contextWindow);

          yield* client.sessions.send({
            params: { id: SESSION },
            payload: { text: "Reply only OK" },
          });
          return yield* header(windowShown);
          // oxlint-disable-next-line effecttsgo/strict-effect-provide -- one run of Fern
        }).pipe(Effect.provide(Fern), Effect.scoped);
        assert.strictEqual(before?.contextTokens, 250);
        assert.strictEqual(before?.contextWindow, 1_000);

        const after = yield* header(Stream.take(1)).pipe(
          // oxlint-disable-next-line effecttsgo/strict-effect-provide -- a second Fern, started afresh
          Effect.provide(Fern),
          Effect.scoped,
        );
        assert.strictEqual(after?.contextTokens, 250);
        assert.strictEqual(after?.contextWindow, 1_000);
      }),
    20_000,
  );
});
