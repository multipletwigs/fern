import { NodeHttpServer } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { FernApi } from "@repo/api";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { createServer, request } from "node:http";
import { HandlersNoDeps } from "../src/http";
import { LiveHandlersNoDeps, LiveServer } from "../src/live";
import { OriginGuard } from "../src/origin";
import { Turns } from "../src/turn/Turns";
import {
  UnusedAutonomy,
  UnusedCommands,
  UnusedFlows,
  UnusedRounds,
  UnusedSubagents,
  UnusedTerminals,
  UnusedTools,
  UnusedTranscripts,
  unusedTurns,
  UnusedVerifySlots,
  UnusedWalkthroughs,
  UnusedWorkspace,
  UnusedWorktreeCleanup,
} from "./stubs";

// Fern's server on a real port, as the app serves it, with every service unused: whether a request
// gets through is decided before any of them would be asked.

const Unused = Layer.mergeAll(
  UnusedRounds,
  UnusedTranscripts,
  UnusedAutonomy,
  UnusedFlows,
  Layer.succeed(Turns, unusedTurns),
  UnusedCommands,
  UnusedWorkspace,
  UnusedWalkthroughs,
  UnusedWorktreeCleanup,
  UnusedSubagents,
  UnusedVerifySlots,
  UnusedTools,
  UnusedTerminals,
);

const Server = HttpRouter.serve(
  Layer.mergeAll(HttpApiBuilder.layer(FernApi), LiveServer, OriginGuard).pipe(
    Layer.provide(
      Layer.mergeAll(HandlersNoDeps, LiveHandlersNoDeps).pipe(
        Layer.provide(Unused),
      ),
    ),
  ),
  { disableLogger: true },
).pipe(
  Layer.provideMerge(
    NodeHttpServer.layer(createServer, { port: 0, host: "127.0.0.1" }),
  ),
);

const serverPort = Effect.gen(function* () {
  const { address } = yield* HttpServer.HttpServer;
  return "port" in address ? address.port : assert.fail("no port");
});

// The status a request gets: 101 when a WebSocket is let in.
const statusOf = (
  port: number,
  options: {
    readonly method?: string;
    readonly path: string;
    readonly headers: Record<string, string>;
  },
) =>
  Effect.callback<number>((resume) => {
    const req = request({
      host: "127.0.0.1",
      port,
      method: options.method ?? "GET",
      agent: false,
      path: options.path,
      headers: options.headers,
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resume(Effect.succeed(res.statusCode ?? 0));
    });
    req.on("response", (res) => {
      res.resume();
      resume(Effect.succeed(res.statusCode ?? 0));
    });
    req.on("error", (error) => resume(Effect.die(error)));
    req.end();
    return Effect.sync(() => req.destroy());
  });

const upgrade = (port: number, headers: Record<string, string>) =>
  statusOf(port, {
    path: "/api/live",
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      ...headers,
    },
  });

layer(Server)("Fern's server", (it) => {
  it.effect("lets Fern's own page open the live WebSocket", () =>
    Effect.gen(function* () {
      const at = yield* serverPort;
      const status = yield* upgrade(at, {
        Host: `127.0.0.1:${at}`,
        Origin: `http://127.0.0.1:${at}`,
      });
      assert.strictEqual(status, 101);
    }),
  );

  it.effect(
    "lets the page Vite serves in development open it through Vite's proxy",
    () =>
      Effect.gen(function* () {
        const status = yield* upgrade(yield* serverPort, {
          Host: "localhost:5173",
          Origin: "http://localhost:5173",
        });
        assert.strictEqual(status, 101);
      }),
  );

  it.effect("refuses the live WebSocket to another website", () =>
    Effect.gen(function* () {
      const at = yield* serverPort;
      const status = yield* upgrade(at, {
        Host: `127.0.0.1:${at}`,
        Origin: "https://evil.example",
      });
      assert.strictEqual(status, 403);
    }),
  );

  it.effect("refuses another page on this machine", () =>
    Effect.gen(function* () {
      const at = yield* serverPort;
      const status = yield* upgrade(at, {
        Host: `127.0.0.1:${at}`,
        Origin: "http://localhost:3000",
      });
      assert.strictEqual(status, 403);
    }),
  );

  it.effect("refuses a website that points its own name at this machine", () =>
    Effect.gen(function* () {
      const at = yield* serverPort;
      const status = yield* upgrade(at, {
        Host: `evil.example:${at}`,
        Origin: `http://evil.example:${at}`,
      });
      assert.strictEqual(status, 403);
    }),
  );

  it.effect("refuses another website's requests to the API", () =>
    Effect.gen(function* () {
      const at = yield* serverPort;
      const status = yield* statusOf(at, {
        method: "POST",
        path: "/api/sessions/some-session/interrupt",
        headers: {
          Host: `127.0.0.1:${at}`,
          Origin: "https://evil.example",
        },
      });
      assert.strictEqual(status, 403);
    }),
  );

  it.effect("answers a request from no page, as from a script", () =>
    Effect.gen(function* () {
      const at = yield* serverPort;
      const status = yield* statusOf(at, {
        path: "/api/health",
        headers: { Host: `127.0.0.1:${at}` },
      });
      assert.isBelow(status, 300);
    }),
  );
});
