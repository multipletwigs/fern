# Fern

Electron desktop app running a Next.js server, with an [Effect v4](https://effect.website/docs/v4/getting-started) HTTP API as the backend.

## Layout

- `apps/desktop`: Electron shell. In dev it loads `http://localhost:3000`; in production it boots the Next.js standalone server in a `utilityProcess` on a free local port.
- `apps/web`: Next.js app. Mounts the Effect API at `app/api/[[...path]]/route.ts`.
- `packages/api` (`@repo/api`): Effect `HttpApi` contract (`.`), handlers (`./server`), and typed client (`./client`).
- `packages/ui`, `packages/typescript-config`: shared starter packages.
- `apps/docs`: leftover Turborepo starter app, safe to delete.

Linting is [oxlint](https://oxc.rs/docs/guide/usage/linter), configured once at the root in `.oxlintrc.json`.

The Effect API runs inside Next's route handlers, so there's one server process and no CORS. Add endpoints in `packages/api/src/Api.ts`, implement them in `packages/api/src/server.ts`, and call them with `makeClient()`. The OpenAPI spec is served at `/api/openapi.json`.

## Commands

```sh
pnpm install
pnpm dev --filter=desktop   # Next dev server + Electron window
pnpm build                  # Next standalone build + Electron main
pnpm --filter=desktop start # run the production build in Electron
pnpm package                # build a .dmg into apps/desktop/release
pnpm check-types
pnpm lint
```
