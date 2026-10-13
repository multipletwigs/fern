import { HttpClientError } from "effect/http";

// Whether a request failed only because Fern's server wasn't there to answer, as while the page
// loads before the main process serves the API: the request never reached it, or Vite's proxy, in
// development, couldn't reach it. Asking again may then work; anything else would fail the same.
export const isTransient = (error: unknown) => {
  if (!HttpClientError.isHttpClientError(error)) return false;
  const { reason } = error;
  if (reason._tag === "TransportError") return true;
  return (
    reason._tag === "StatusCodeError" &&
    [502, 503, 504].includes(reason.response.status)
  );
};
