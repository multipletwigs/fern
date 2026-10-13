import { Handlers } from "./http";
import { fernRoutes } from "./routes";

export { DatabaseLive } from "./database/Database";
export { WorktreesDir } from "./worktree/Worktrees";

// The API's routes and the live streams' WebSocket on the real services, behind the origin guard.
// Needs a database, e.g. DatabaseLive, and a folder for Sessions' worktrees.
export const ApiLive = fernRoutes(Handlers);
