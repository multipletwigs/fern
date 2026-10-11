import { FernApi } from "@repo/api";
import { Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Handlers } from "./http";

// The API's routes, ready to mount on an HttpRouter served by any HTTP server.
export const ApiLive = HttpApiBuilder.layer(FernApi, {
  openapiPath: "/api/openapi.json",
}).pipe(Layer.provide(Handlers));
