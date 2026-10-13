import { Effect } from "effect";
import {
  type Headers,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";

// The names this machine goes by. A website can point its own name at this machine, but can't take
// one of these.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// What a browser says of where a request comes from, in Sec-Fetch-Site, when it's Fern's own page
// asking or the window opening it.
const OWN_SITE = new Set(["same-origin", "none"]);

// Whether a request comes from Fern's own page, or from no page at all, as from a script on this
// machine. Fern's page is served from this machine, by the address it asked for: the app's own
// server's, or Vite's in development, which passes the page's headers on to the API. Any other page
// is another website reaching into Fern through the developer's browser, where the live WebSocket
// would let it type into a Session's shell. A browser leaves the Origin off another website's GET,
// from an <img> or a <script>, but says where it comes from in Sec-Fetch-Site; a script sends
// neither.
export const isFernRequest = (headers: Headers.Headers) => {
  const site = headers["sec-fetch-site"];
  if (site !== undefined && !OWN_SITE.has(site)) return false;
  const { origin, host } = headers;
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
      if (!isFernRequest(request.headers))
        return HttpServerResponse.text("Not Fern's page", { status: 403 });
      return yield* httpEffect;
    }),
  { global: true },
);
