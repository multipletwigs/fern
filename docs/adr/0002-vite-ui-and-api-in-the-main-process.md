# Vite UI, with the API served by the Electron main process

Fern dropped Next.js. The UI is a Vite + React app, and the Effect API runs as a real HTTP server inside the Electron main process (`apps/desktop/src/AppServer.ts`) rather than in Next route handlers. Fern is a local desktop app with no use for SSR, and Next was costing more than it gave: hydration workarounds on every atom, a standalone-server staging step, a utility process to host it, and a Turbopack dev-server reload loop we could not fix from our side.

## Consequences

- One origin, no CORS: in dev Vite proxies `/api` to the main process on port 7420; in production a single server on a free port serves both the API and the built UI.
- The API, including the Agent SDK, now lives in the main process, which is where hosted Sessions will spawn `claude` anyway (ADR 0001).
- Server and main-process changes need an Electron restart in dev; only the UI hot-reloads.
