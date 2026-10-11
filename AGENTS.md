<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# Effect

Application logic is written with [Effect v4](https://effect.website/docs/v4/getting-started). Before writing Effect code, read `../effect/LLMS.md` and the matching example under `../effect/ai-docs/src/` (a local clone of Effect-TS/effect, if present); prefer it over web docs. Installed versions win if they differ from that checkout.

- `packages/api`: client-safe `HttpApi` contract (schemas, endpoints). No server code.
- `packages/server`: services (`Context.Service` + `Layer`) and handlers. Test with `@effect/vitest` and `HttpApiTest`.
- `apps/desktop/src`: the Electron main process is an Effect program (`NodeRuntime.runMain`); resources use `Effect.acquireRelease`.
- `apps/web`: talks to the API through `ApiClient` (`AtomHttpApi`) and `@effect/atom-react`.

`pnpm lint` runs oxlint with the Effect rules from `@effect/tsgo`; `pnpm install` patches TypeScript and oxlint for them via `prepare`.
