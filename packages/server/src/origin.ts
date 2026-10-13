import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

// The names this machine goes by. A website can point its own name at this machine, but can't take
// one of these.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Whether a request comes from Fern's own page, or from no page at all, as from a script on this
// machine. Fern's page is served from this machine, by the address it asked for: the app's own
// server's, or Vite's in development, which passes the page's Host on to the API. Any other page
// is another website reaching into Fern through the developer's browser, where the live WebSocket
// would let it type into a Session's shell.
export const isFernOrigin = (
  origin: string | undefined,
  host: string | undefined,
) => {
  if (origin === undefined) return true;
  if (host === undefined || !URL.canParse(origin)) return false;
  const page = new URL(origin);
  return (
    page.protocol === "http:" &&
    page.host === host.toLowerCase() &&
    LOOPBACK.has(page.hostname)
  );
};

// Refuses every request, the live WebSocket's included, from a page that isn't Fern's own.
export const OriginGuard = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (!isFernOrigin(request.headers.origin, request.headers.host))
        return HttpServerResponse.text("Not Fern's page", { status: 403 });
      return yield* httpEffect;
    }),
  { global: true },
);
