// The developer closes a Subagent's tab once they've read it. Fern remembers the close for the
// Session, so the tab stays closed after Fern restarts, until they reopen it from the chat.
import { assert, describe, it } from "@effect/vitest";
import { FernApi, LiveRpcs, type SubagentSummary } from "@repo/api";
import { Effect, Layer, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { RpcTest } from "effect/rpc";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import { NoWorktreesDir, NoWriter } from "./stubs";

const SESSION = "6c3a9d41-7b2e-4f53-8a1d-9e0b1c2d3f4a";
const OTHER = "7d4b0e52-8c3f-4a64-9b2e-0f1c2d3e4a5b";
// Claude Code's own shape for agent ids: "a" and 16 hex digits.
const MAPPER = "a1a0000000000000a";
const PLANNER = "a1b0000000000000b";

const line = (
  sessionId: string,
  uuid: number,
  type: "user" | "assistant",
  message: object,
  agentId?: string,
) =>
  JSON.stringify({
    type,
    uuid: `00000000-0000-4000-8000-${String(uuid).padStart(12, "0")}`,
    parentUuid:
      uuid % 100 === 1
        ? null
        : `00000000-0000-4000-8000-${String(uuid - 1).padStart(12, "0")}`,
    sessionId,
    timestamp: `2026-10-11T10:00:0${uuid % 100}.000Z`,
    cwd: "/repo",
    entrypoint: "cli",
    ...(agentId ? { isSidechain: true, agentId } : {}),
    message,
  });

const configDir = mkdtempSync(join(tmpdir(), "fern-claude-"));
const projectDir = join(configDir, "projects", "-repo");

// A Session whose agent started a Subagent for each id, each with its Assignment written.
const writeSession = (
  sessionId: string,
  agents: ReadonlyArray<string>,
  base: number,
) => {
  const subagentsDir = join(projectDir, sessionId, "subagents");
  mkdirSync(subagentsDir, { recursive: true });
  writeFileSync(
    join(projectDir, `${sessionId}.jsonl`),
    `${line(sessionId, base + 1, "user", { role: "user", content: "Look around" })}\n`,
  );
  agents.forEach((agentId, i) => {
    writeFileSync(
      join(subagentsDir, `agent-${agentId}.jsonl`),
      `${line(sessionId, base + 101 + i * 100, "user", { role: "user", content: `Task ${i}` }, agentId)}\n`,
    );
    writeFileSync(
      join(subagentsDir, `agent-${agentId}.meta.json`),
      JSON.stringify({ agentType: "Explore", description: `Task ${i}` }),
    );
  });
};
writeSession(SESSION, [MAPPER, PLANNER], 1000);
writeSession(OTHER, [MAPPER], 5000);
process.env.CLAUDE_CONFIG_DIR = configDir;

const makeClient = HttpApiTest.groups(FernApi, ["subagents"]);
const makeLive = RpcTest.makeClient(LiveRpcs);

// One run of Fern on the database, shut down after.
const runOn =
  (database: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const context = yield* Layer.build(
        Layer.mergeAll(
          handlersWith(NoWriter).pipe(
            Layer.provide([DatabaseLive(database), NoWorktreesDir]),
          ),
          HttpServer.layerServices,
        ),
      );
      return yield* effect.pipe(Effect.provideContext(context));
    }).pipe(Effect.scoped);

// Which of the Session's Subagents are closed, by agent id.
const closes = (list: ReadonlyArray<SubagentSummary> | undefined) =>
  Object.fromEntries((list ?? []).map((s) => [s.agentId, s.closed]));

// The Session's Subagents, once the predicate holds of them.
const listWhere = (
  sessionId: string,
  predicate: (list: ReadonlyArray<SubagentSummary>) => boolean = () => true,
) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    const [list] = yield* live
      .Subagents({ sessionId })
      .pipe(
        Stream.filter(predicate),
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("5 seconds"),
      );
    return closes(list);
  });

describe("Closing a Subagent's tab", () => {
  it.live(
    "keeps it closed for the Session after Fern restarts, until it's reopened",
    () =>
      Effect.gen(function* () {
        const database = join(
          mkdtempSync(join(tmpdir(), "fern-db-")),
          "fern.db",
        );
        const run = runOn(database);

        yield* run(
          Effect.gen(function* () {
            assert.deepStrictEqual(yield* listWhere(SESSION), {
              [MAPPER]: false,
              [PLANNER]: false,
            });
            const client = yield* makeClient;
            yield* client.subagents.close({
              params: { sessionId: SESSION, agentId: MAPPER },
            });
            // The open stream reports the close.
            assert.deepStrictEqual(
              yield* listWhere(SESSION, (list) =>
                list.some((s) => s.agentId === MAPPER && s.closed),
              ),
              { [MAPPER]: true, [PLANNER]: false },
            );
          }),
        );

        yield* run(
          Effect.gen(function* () {
            assert.deepStrictEqual(yield* listWhere(SESSION), {
              [MAPPER]: true,
              [PLANNER]: false,
            });
            // Only in the Session it was closed in.
            assert.deepStrictEqual(yield* listWhere(OTHER), {
              [MAPPER]: false,
            });
            const client = yield* makeClient;
            yield* client.subagents.reopen({
              params: { sessionId: SESSION, agentId: MAPPER },
            });
          }),
        );

        yield* run(
          Effect.gen(function* () {
            assert.deepStrictEqual(yield* listWhere(SESSION), {
              [MAPPER]: false,
              [PLANNER]: false,
            });
          }),
        );
      }),
    20_000,
  );

  it.live("fails for an agent the Session doesn't have", () =>
    runOn(":memory:")(
      Effect.gen(function* () {
        const client = yield* makeClient;
        const error = yield* client.subagents
          .close({
            params: { sessionId: SESSION, agentId: "a1f0000000000099f" },
          })
          .pipe(Effect.flip);
        assert.strictEqual(error._tag, "SubagentNotFound");
      }),
    ),
  );
});
