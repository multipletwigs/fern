# Fern's server trusts only its own page and local processes

Fern's server can start a shell in a Session's folder, run `claude`, `gh` and `git`, and read any Project's files, all from a request. It listens on loopback only, but that isn't enough: any website the developer visits can send requests to `127.0.0.1` through their browser. So every request has to prove it comes from Fern's own page or from no page at all:

- **One guarded router.** Every route, the live WebSocket at `/api/live` included, is built through `fernRoutes`, which always mounts `OriginGuard` with it. There's no other way to put Fern's routes together.
- **What the guard lets in:** a request whose Origin is a loopback name (`localhost`, `127.0.0.1`, `[::1]`) equal to its Host header, and whose `Sec-Fetch-Site`, when present, is `same-origin` or `none`. The Host equality rules out other localhost ports and DNS rebinding. `Sec-Fetch-Site` catches another site's GETs, which browsers send without an Origin.
- **Local processes are trusted on purpose.** A request with neither header comes from a script on this machine. That script can already do anything the developer can, so refusing it would protect nothing.
- **The server works out what a request acts on.** Folders and shells are found from the Session id through Fern's own records, never taken from the client. A request for a Session Fern doesn't know fails; it doesn't quietly do nothing.
- **The app window stays on Fern's page.** `linkAction` compares a link's parsed origin with the app's. Only http, https and mailto links are handed to the OS, and every other link is dropped. The window refuses every permission request.

## Considered Options

- **A per-run token** that the main process injects into the page and the guard requires on every request. It's stronger and doesn't depend on browser headers, but every client would have to carry it, including Vite in dev and `curl` in tests and Verify slots. Rejected for now; revisit if a client appears that browser headers can't vouch for.
- **Origin alone.** Not enough: browsers leave the Origin off another site's GET from an `<img>` or `<script>`, and those reached `/api/tools` and `/api/projects/commands`, which spawn processes.

## Consequences

- Any new endpoint or Live RPC is guarded just by being built through `fernRoutes`. The Security section of CODING_STANDARDS.md covers the judgement left to review.
- The ProjectFiles, File and Changes RPCs still take a folder from the client, so a local process can read any folder through them. Resolving them from the Session is tracked in #35.
- The terminal's shell inherits the developer's environment, like their own terminal. Anything that can reach the shell can read that environment, which is why reaching the shell is what the guard protects.
