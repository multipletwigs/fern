import { layer } from "@effect/vitest";
import { FernApi } from "@repo/api";
import { Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { HandlersNoDeps } from "../src/http";
import { Turns } from "../src/turn/Turns";
import {
  UnusedCommands,
  UnusedRounds,
  UnusedTranscripts,
  unusedTurns,
  UnusedWalkthroughs,
  UnusedWorkspace,
} from "./stubs";

const makeClient = HttpApiTest.groups(FernApi, ["system"]);

const Unused = Layer.mergeAll(
  UnusedRounds,
  UnusedTranscripts,
  Layer.succeed(Turns, unusedTurns),
  UnusedCommands,
  UnusedWorkspace,
  UnusedWalkthroughs,
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
