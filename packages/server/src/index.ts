import { FernApi } from "@repo/api";
import { Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Handlers } from "./http";
import { LiveServer } from "./live";

export { DatabaseLive } from "./database/Database";

// The API's routes and the live streams' WebSocket, ready to mount on an HttpRouter served by any
// HTTP server. Needs a database, e.g. DatabaseLive.
export const ApiLive = Layer.mergeAll(
  HttpApiBuilder.layer(FernApi, { openapiPath: "/api/openapi.json" }),
  LiveServer,
).pipe(Layer.provide(Handlers));
