import { HttpApi, OpenApi } from "effect/http-api";
import { GreetingsApi } from "./Greetings";
import { SystemApi } from "./System";

// Client-safe contract shared by @repo/server and the frontend. Keep server code out of this package.
// Mounted under /api to line up with Next's app/api/[[...path]] route.
export class FernApi extends HttpApi.make("fern")
  .add(GreetingsApi)
  .add(SystemApi)
  .prefix("/api")
  .annotateMerge(OpenApi.annotations({ title: "Fern API" })) {}
