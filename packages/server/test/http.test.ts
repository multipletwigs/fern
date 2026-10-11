import { assert, layer } from "@effect/vitest";
import { FernApi } from "@repo/api";
import { Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { Greeter } from "../src/Greeter";
import { HandlersNoDeps } from "../src/http";
import { Transcripts } from "../src/transcript/Transcripts";

const makeClient = HttpApiTest.groups(FernApi, ["greetings", "system"]);

const Unused = Layer.succeed(Transcripts, {
  current: Effect.die("unused"),
  live: () => Effect.die("unused"),
});

layer(
  Layer.mergeAll(
    HandlersNoDeps.pipe(Layer.provide([Greeter.layer, Unused])),
    HttpServer.layerServices,
  ),
)("FernApi", (it) => {
  it.effect("greets by name and counts greetings", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const first = yield* client.greetings.hello({ query: { name: "Fern" } });
      const second = yield* client.greetings.hello({ query: {} });

      assert.strictEqual(first.message, "Hello, Fern!");
      assert.strictEqual(second.message, "Hello, world!");
      assert.strictEqual(second.count, first.count + 1);
    }),
  );

  it.effect("rejects an empty name", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.greetings
        .hello({ query: { name: "" } })
        .pipe(Effect.flip);
      assert.isDefined(error);
    }),
  );

  it.effect("reports health", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      yield* client.health();
    }),
  );
});
