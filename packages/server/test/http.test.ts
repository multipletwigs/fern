import { layer } from "@effect/vitest";
import { FernApi } from "@repo/api";
import { Effect, Layer, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { HandlersNoDeps } from "../src/http";
import { Commands } from "../src/commands/Commands";
import { Transcripts } from "../src/transcript/Transcripts";
import { Turns } from "../src/turn/Turns";
import { Workspace } from "../src/workspace/Workspace";

const makeClient = HttpApiTest.groups(FernApi, ["system"]);

const Unused = Layer.mergeAll(
  Layer.succeed(
    Transcripts,
    Transcripts.of({
      current: Effect.die("unused"),
      projects: Stream.die("unused"),
      live: () => Effect.die("unused"),
    }),
  ),
  Layer.succeed(
    Turns,
    Turns.of({
      send: () => Effect.die("unused"),
      start: () => Effect.die("unused"),
      interrupt: () => Effect.die("unused"),
      turn: () => Effect.die("unused"),
      running: Effect.die("unused"),
    }),
  ),
  Layer.succeed(Commands, Commands.of({ list: () => Effect.die("unused") })),
  Layer.succeed(
    Workspace,
    Workspace.of({
      files: () => Effect.die("unused"),
      file: () => Effect.die("unused"),
    }),
  ),
);

layer(
  Layer.mergeAll(
    HandlersNoDeps.pipe(Layer.provide(Unused)),
    HttpServer.layerServices,
  ),
)("FernApi", (it) => {
  it.effect("reports health", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      yield* client.health();
    }),
  );
});
