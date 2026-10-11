# Fern

Electron desktop app with a Vite + React UI and an [Effect v4](https://effect.website/docs/v4/getting-started) HTTP API served by the main process.

## Layout

- `apps/desktop`: Electron shell, written as an Effect program. Its `AppServer` serves the Effect API under `/api`. In dev that's on port 7420 and the window loads Vite at `http://localhost:5173`; in production one server on a free local port serves the API and the built UI from `Resources/web`. Bundled with tsdown.
- `apps/web`: Vite + React UI. Calls the API through `ApiClient` (Effect atoms) with relative URLs; in dev, Vite proxies `/api` to the main process.
- `packages/api` (`@repo/api`): client-safe Effect `HttpApi` contract: schemas and endpoints.
- `packages/server` (`@repo/server`): Effect services, layers, and handlers implementing the contract, with tests.
- `packages/ui`, `packages/typescript-config`: shared starter packages.

The UI and the API share an origin (Vite's proxy in dev, one server in production), so there's no CORS. To add an endpoint: define it in `packages/api`, implement it in `packages/server/src/http.ts` (backed by a service), and query it from the web app with `ApiClient.query(...)`. The OpenAPI spec is served at `/api/openapi.json`.

Linting is [oxlint](https://oxc.rs/docs/guide/usage/linter) plus Effect's type-aware rules from [`@effect/tsgo`](https://github.com/Effect-TS/tsgo), configured in `.oxlintrc.json`. The same package adds Effect hovers and refactors to your editor; point your editor at the workspace TypeScript version.

## Commands

```sh
pnpm install
pnpm dev --filter=desktop   # Vite + Electron window (restart it after main-process or server changes)
pnpm build                  # Vite build + Electron main
pnpm --filter=desktop start # run the production build in Electron
pnpm package                # build a .dmg into apps/desktop/release
pnpm check-types
pnpm lint
pnpm test
```
