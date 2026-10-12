import { layer } from "@effect/vitest";
import { FernApi } from "@repo/api";
import { Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { HandlersNoDeps } from "../src/http";
import { Turns } from "../src/turn/Turns";
import {
  UnusedCommands,
  UnusedAutonomy,
  UnusedFlows,
  UnusedRounds,
  UnusedTranscripts,
  unusedTurns,
  UnusedWalkthroughs,
  UnusedWorkspace,
  UnusedWorktreeCleanup,
} from "./stubs";

const makeClient = HttpApiTest.groups(FernApi, ["system"]);

const Unused = Layer.mergeAll(
  UnusedRounds,
  UnusedTranscripts,
  UnusedAutonomy,
  UnusedFlows,
  Layer.succeed(Turns, unusedTurns),
  UnusedCommands,
  UnusedWorkspace,
  UnusedWalkthroughs,
  UnusedWorktreeCleanup,
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
