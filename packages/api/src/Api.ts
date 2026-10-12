import { HttpApi, OpenApi } from "effect/http-api";
import { FlowsApi } from "./Flows";
import { ProjectsApi } from "./Projects";
import { SessionsApi } from "./Sessions";
import { SystemApi } from "./System";
import { WalkthroughsApi } from "./Walkthroughs";

// Client-safe contract shared by @repo/server and the frontend. Keep server code out of this package.
// Mounted under /api, the path the web app calls relative to its own origin.
export class FernApi extends HttpApi.make("fern")
  .add(SystemApi)
  .add(SessionsApi)
  .add(ProjectsApi)
  .add(WalkthroughsApi)
  .add(FlowsApi)
  .prefix("/api")
  .annotateMerge(OpenApi.annotations({ title: "Fern API" })) {}
