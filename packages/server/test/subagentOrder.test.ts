// The Subagents stream lists a Session's Subagents in the order they started, in a total order:
// those started at the same moment by agent id, and those whose start isn't known last.
import { assert, layer } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import { HttpServer } from "effect/http";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import {
  assistant,
  makeConfig,
  makeLive,
  text,
  transcriptOf,
  user,
  writeSession,
} from "./subagentFixture";
import { NoWorktreesDir, NoWriter } from "./stubs";

const SESSION = "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c";
// In the order the Agent SDK lists them: by agent id.
const UNDATED = "a1d0000000000001d";
const LATE = "a2d0000000000002d";
const GARBLED = "a3d0000000000003d";
const TIED_B = "a5d0000000000005d";
const TIED_A = "a4d0000000000004d";
const EARLY = "a6d0000000000006d";

const main = transcriptOf(SESSION);
const projectDir = makeConfig();
const { subagent } = writeSession(projectDir, SESSION, [
  main(0, "user", user("Look into the code"), { origin: { kind: "human" } }),
]);

const started = (agentId: string, second: number | undefined) => {
  const line = transcriptOf(SESSION, agentId);
  subagent(agentId, `toolu_${agentId}`, [
    line(second, "user", user(`Task of ${agentId}`)),
    line(second, "assistant", assistant([text("Done.")])),
  ]);
};
started(UNDATED, undefined);
started(LATE, 9);
started(TIED_B, 5);
started(TIED_A, 5);
started(EARLY, 2);
// A timestamp that isn't one says no more than none.
const garbled = transcriptOf(SESSION, GARBLED);
subagent(GARBLED, "toolu_garbled", [
  garbled(undefined, "user", user("Task"), { timestamp: "not a time" }),
]);

layer(
  Layer.mergeAll(
    handlersWith(NoWriter).pipe(
      Layer.provide([DatabaseLive(":memory:"), NoWorktreesDir]),
    ),
    HttpServer.layerServices,
  ),
  { excludeTestServices: true },
)("Subagent order", (it) => {
  it.effect(
    "lists Subagents by start, ties by agent id, those with no start last",
    () =>
      Effect.gen(function* () {
        const live = yield* makeLive;
        const [list] = yield* live
          .Subagents({ sessionId: SESSION })
          .pipe(Stream.take(1), Stream.runCollect);
        assert.deepStrictEqual(
          list?.map((s) => s.agentId),
          [EARLY, TIED_A, TIED_B, LATE, UNDATED, GARBLED],
        );
      }),
  );
});
