// A Subagent's files are an undocumented format Claude Code may change. One that can't be read
// mustn't take the chat down with it: the chat streams, its Agent call rows as the Session's own
// transcript says.
import { assert, layer } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import { HttpServer } from "effect/http";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import {
  assistant,
  makeConfig,
  makeLive,
  result,
  toolUse,
  transcriptOf,
  user,
  writeSession,
} from "./subagentFixture";
import { NoWorktreesDir, NoWriter } from "./stubs";

const SESSION = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const CORRUPT = "a1e0000000000001e";

const main = transcriptOf(SESSION);
const projectDir = makeConfig();
const { subagent } = writeSession(projectDir, SESSION, [
  main(0, "user", user("Look into the code"), { origin: { kind: "human" } }),
  main(
    1,
    "assistant",
    assistant([
      toolUse("toolu_corrupt", "Agent", {
        description: "Map the code",
        prompt: "Map how transcripts are read.",
      }),
    ]),
  ),
  main(
    2,
    "user",
    user([result("toolu_corrupt", `It's mapped.\nagentId: ${CORRUPT}`)]),
  ),
]);
// Its reply carries no content at all.
const line = transcriptOf(SESSION, CORRUPT);
subagent(CORRUPT, "toolu_corrupt", [
  line(1, "user", user("Map how transcripts are read.")),
  line(2, "assistant", { id: "msg_corrupt", role: "assistant" }),
]);

layer(
  Layer.mergeAll(
    handlersWith(NoWriter).pipe(
      Layer.provide([DatabaseLive(":memory:"), NoWorktreesDir]),
    ),
    HttpServer.layerServices,
  ),
  { excludeTestServices: true },
)("A corrupt Subagent", (it) => {
  it.effect("leaves the chat streaming", () =>
    Effect.gen(function* () {
      const live = yield* makeLive;
      const [chat] = yield* live
        .Transcript({ id: SESSION })
        .pipe(Stream.take(1), Stream.runCollect);
      assert.deepStrictEqual(
        chat?.upserts.map((item) =>
          item._tag === "Subagent" ? [item._tag, item.status] : [item._tag],
        ),
        [["Prompt"], ["Subagent", "done"]],
      );
    }),
  );
});
