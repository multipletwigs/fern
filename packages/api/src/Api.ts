import { HttpApi, OpenApi } from "effect/http-api";
import { AutonomyApi } from "./Autonomy";
import { FlowsApi } from "./Flows";
import { ProjectsApi } from "./Projects";
import { PullRequestsApi } from "./PullRequests";
import { RoundsApi } from "./Rounds";
import { SessionsApi } from "./Sessions";
import { SubagentsApi } from "./Subagents";
import { SystemApi } from "./System";
import { VerifySlotsApi } from "./VerifySlots";
import { WalkthroughsApi } from "./Walkthroughs";

// Client-safe contract shared by @repo/server and the frontend. Keep server code out of this package.
// Mounted under /api, the path the web app calls relative to its own origin.
export class FernApi extends HttpApi.make("fern")
  .add(SystemApi)
  .add(SessionsApi)
  .add(ProjectsApi)
  .add(WalkthroughsApi)
  .add(FlowsApi)
  .add(RoundsApi)
  .add(AutonomyApi)
  .add(SubagentsApi)
  .add(VerifySlotsApi)
  .add(PullRequestsApi)
  .prefix("/api")
  .annotateMerge(OpenApi.annotations({ title: "Fern API" })) {}
