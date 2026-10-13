import { FernApi } from "@repo/api";
import { Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { LiveServer } from "./live";
import { OriginGuard } from "./origin";

// The API's routes and the live streams' WebSocket on the given handlers, ready to mount on an
// HttpRouter served by any HTTP server, which then refuses every request from a page that isn't
// Fern's own. The one way Fern's routes are put together, so none goes out unguarded.
export const fernRoutes = <A, E, R>(handlers: Layer.Layer<A, E, R>) =>
  Layer.mergeAll(
    HttpApiBuilder.layer(FernApi, { openapiPath: "/api/openapi.json" }),
    LiveServer,
    OriginGuard,
  ).pipe(Layer.provide(handlers));
