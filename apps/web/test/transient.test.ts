import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import { isTransient } from "../src/transient";

const request = HttpClientRequest.get("http://localhost/api/tools");

const answered = (status: number) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.StatusCodeError({
      request,
      response: HttpClientResponse.fromWeb(
        request,
        new Response(null, { status }),
      ),
    }),
  });

it("calls a request that never reached the server transient", () => {
  assert.isTrue(
    isTransient(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({ request }),
      }),
    ),
  );
});

it("calls Vite's proxy failing to reach the server transient", () => {
  for (const status of [502, 503, 504])
    assert.isTrue(isTransient(answered(status)));
});

it("calls the server's own answer final", () => {
  for (const status of [400, 403, 404, 500])
    assert.isFalse(isTransient(answered(status)), String(status));
});

it.effect("calls an answer the page can't read final", () =>
  Effect.gen(function* () {
    const unreadable = yield* Schema.decodeUnknownEffect(Schema.String)(1).pipe(
      Effect.flip,
    );
    assert.isFalse(isTransient(unreadable));
  }),
);
