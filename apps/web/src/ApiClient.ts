import { FernApi } from "@repo/api";
import { FetchHttpClient } from "effect/http";
import { AtomHttpApi } from "effect/reactivity";

// Typed client for FernApi whose queries and mutations are atoms. Relative URLs resolve against
// the page's origin: the Electron app's own server in production, Vite (proxying /api) in dev.
/**
 * The top-level group's methods read as requiring a conditional type of the response mode; both
 * of its branches are `never`, so nothing leaks.
 * @effect-expect-leaking [Mode] extends ["response-only"] ? never : never
 */
export class ApiClient extends AtomHttpApi.Service<ApiClient>()(
  "web/ApiClient",
  {
    api: FernApi,
    httpClient: FetchHttpClient.layer,
  },
) {}
