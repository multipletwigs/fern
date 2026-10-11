import { FernApi } from "@repo/api";
import { Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { Handlers } from "./http";

export const ApiLive = HttpApiBuilder.layer(FernApi, {
  openapiPath: "/api/openapi.json",
}).pipe(Layer.provide(Handlers), Layer.provide(HttpServer.layerServices));

// Fetch-compatible handler for Next.js route handlers. The layer is built once per server process.
export const { handler, dispose } = HttpRouter.toWebHandler(ApiLive);
