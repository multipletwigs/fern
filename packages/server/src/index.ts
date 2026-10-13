import { FernApi } from "@repo/api";
import { Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Handlers } from "./http";
import { LiveServer } from "./live";
import { OriginGuard } from "./origin";

export { DatabaseLive } from "./database/Database";
export { WorktreesDir } from "./worktree/Worktrees";

// The API's routes and the live streams' WebSocket, ready to mount on an HttpRouter served by any
// HTTP server, which then refuses every request from a page that isn't Fern's own. Needs a
// database, e.g. DatabaseLive, and a folder for Sessions' worktrees.
export const ApiLive = Layer.mergeAll(
  HttpApiBuilder.layer(FernApi, { openapiPath: "/api/openapi.json" }),
  LiveServer,
  OriginGuard,
).pipe(Layer.provide(Handlers));
