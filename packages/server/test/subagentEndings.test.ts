// How a Subagent ended, as its Session learned it: an Agent call the developer interrupted, and
// Claude Code's task notifications, several of which can arrive in one message.
import { assert, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import {
  age,
  assistant,
  launched,
  makeConfig,
  notification,
  result,
  statuses,
  toolUse,
  transcriptOf,
  user,
  writeSession,
} from "./subagentFixture";
import { NoWorktreesDir, NoWriter } from "./stubs";

const SESSION = "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b";
const INTERRUPTED = "a1c0000000000001c";
const COMPLETED = "a2c0000000000002c";
const FAILED = "a3c0000000000003c";

const main = transcriptOf(SESSION);
const sessionLines = [
  main(0, "user", user("Look into the code"), { origin: { kind: "human" } }),
  main(
    1,
    "assistant",
    assistant([
      toolUse("toolu_completed", "Agent", {
        description: "Write the recipe",
        prompt: "Write a verify recipe.",
        run_in_background: true,
      }),
      toolUse("toolu_failed", "Agent", {
        description: "Plan the work",
        prompt: "Plan the work.",
        run_in_background: true,
      }),
    ]),
  ),
  main(
    2,
    "user",
    user([
      result("toolu_completed", launched(COMPLETED)),
      result("toolu_failed", launched(FAILED)),
    ]),
  ),
  main(
    3,
    "assistant",
    assistant([
      toolUse("toolu_interrupted", "Agent", {
        description: "Map the code",
        subagent_type: "Explore",
        prompt: "Map how transcripts are read.",
      }),
    ]),
  ),
  // The developer pressed Esc while the foreground Subagent worked.
  main(
    9,
    "user",
    user([
      result(
        "toolu_interrupted",
        "[Request interrupted by user for tool use]",
        true,
      ),
    ]),
  ),
  main(9, "user", user("[Request interrupted by user for tool use]")),
  // Both background Subagents ended at once.
  main(
    10,
    "user",
    user(
      `${notification("toolu_completed", "completed")}\n${notification("toolu_failed", "failed")}`,
    ),
    { origin: { kind: "task-notification" } },
  ),
];

const projectDir = makeConfig();
const { session, subagent } = writeSession(projectDir, SESSION, sessionLines);
age(session, 20);

// Each was cut off mid-work, without a Hand-back, and its file went quiet long ago.
const cutOff = (agentId: string, callId: string, assignment: string) => {
  const line = transcriptOf(SESSION, agentId);
  age(
    subagent(agentId, callId, [
      line(4, "user", user(assignment)),
      line(5, "assistant", assistant([toolUse(`${callId}_ls`, "Bash", {})])),
      line(6, "user", user([result(`${callId}_ls`, "a.ts")])),
    ]),
    20,
  );
};
cutOff(INTERRUPTED, "toolu_interrupted", "Map how transcripts are read.");
cutOff(COMPLETED, "toolu_completed", "Write a verify recipe.");
cutOff(FAILED, "toolu_failed", "Plan the work.");

layer(
  Layer.mergeAll(
    handlersWith(NoWriter).pipe(
      Layer.provide([DatabaseLive(":memory:"), NoWorktreesDir]),
    ),
    HttpServer.layerServices,
  ),
  { excludeTestServices: true },
)("Subagent endings", (it) => {
  it.effect("shows an Agent call the developer interrupted as stopped", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* statuses(SESSION, INTERRUPTED, "toolu_interrupted"),
        { row: "stopped", tab: "stopped", view: "stopped" },
      );
    }),
  );

  it.effect("reads every task notification in one message", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* statuses(SESSION, COMPLETED, "toolu_completed"),
        { row: "done", tab: "done", view: "done" },
      );
      assert.deepStrictEqual(
        yield* statuses(SESSION, FAILED, "toolu_failed"),
        { row: "failed", tab: "failed", view: "failed" },
      );
    }),
  );
});
