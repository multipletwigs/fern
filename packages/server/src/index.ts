import { FernApi } from "@repo/api";
import { Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Handlers } from "./http";

export { DatabaseLive } from "./database/Database";

// The API's routes, ready to mount on an HttpRouter served by any HTTP server. Needs a database,
// e.g. DatabaseLive.
export const ApiLive = HttpApiBuilder.layer(FernApi, {
  openapiPath: "/api/openapi.json",
}).pipe(Layer.provide(Handlers));
