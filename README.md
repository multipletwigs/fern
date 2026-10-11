# Fern

Electron desktop app running a Next.js server, with an [Effect v4](https://effect.website/docs/v4/getting-started) HTTP API as the backend.

## Layout

- `apps/desktop`: Electron shell, written as an Effect program. In dev it loads `http://localhost:3000`; in production it boots the Next.js standalone server in a `utilityProcess` on a free local port and kills it on quit. Bundled with tsdown.
- `apps/web`: Next.js app. Mounts the Effect API at `app/api/[[...path]]/route.ts` and calls it through `ApiClient` (Effect atoms).
- `packages/api` (`@repo/api`): client-safe Effect `HttpApi` contract: schemas and endpoints.
- `packages/server` (`@repo/server`): Effect services, layers, and handlers implementing the contract, with tests.
- `packages/ui`, `packages/typescript-config`: shared starter packages.
- `apps/docs`: leftover Turborepo starter app, safe to delete.

The Effect API runs inside Next's route handlers, so there's one server process and no CORS. To add an endpoint: define it in `packages/api`, implement it in `packages/server/src/http.ts` (backed by a service), and query it from the web app with `ApiClient.query(...)`. The OpenAPI spec is served at `/api/openapi.json`.

Linting is [oxlint](https://oxc.rs/docs/guide/usage/linter) plus Effect's type-aware rules from [`@effect/tsgo`](https://github.com/Effect-TS/tsgo), configured in `.oxlintrc.json`. The same package adds Effect hovers and refactors to your editor; point your editor at the workspace TypeScript version.

## Commands

```sh
pnpm install
pnpm dev --filter=desktop   # Next dev server + Electron window
pnpm build                  # Next standalone build + Electron main
pnpm --filter=desktop start # run the production build in Electron
pnpm package                # build a .dmg into apps/desktop/release
pnpm check-types
pnpm lint
pnpm test
```
