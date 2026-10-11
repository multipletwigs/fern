import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { FernApi, Greeting } from "./Api";

const GreetingsLive = HttpApiBuilder.group(FernApi, "greetings", (handlers) =>
  handlers.handle("hello", ({ query }) =>
    Effect.succeed(
      new Greeting({
        message: `Hello, ${query.name ?? "world"}!`,
        runtime: `node ${process.versions.node}`,
      }),
    ),
  ),
);

const ApiLive = HttpApiBuilder.layer(FernApi, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide(GreetingsLive),
  Layer.provide(NodeHttpServer.layerHttpServices),
);

export const { handler, dispose } = HttpRouter.toWebHandler(ApiLive);
