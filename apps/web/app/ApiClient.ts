import { FernApi } from "@repo/api";
import { FetchHttpClient } from "effect/http";
import { AtomHttpApi } from "effect/reactivity";

// Typed client for FernApi whose queries and mutations are atoms. Relative URLs resolve against
// the current origin, which is the bundled Next server in Electron.
export class ApiClient extends AtomHttpApi.Service<ApiClient>()(
  "web/ApiClient",
  {
    api: FernApi,
    httpClient: FetchHttpClient.layer,
  },
) {}
