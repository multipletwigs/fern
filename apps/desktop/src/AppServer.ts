import { NodeHttpServer } from "@effect/platform-node";
import { ApiLive, DatabaseLive, WorktreesDir } from "@repo/server";
import { app } from "electron";
import { Context, Effect, Layer } from "effect";
import { HttpRouter, HttpServer, HttpStaticServer } from "effect/http";
import { createServer } from "node:http";
import path from "node:path";

// Fern's local HTTP server: the Effect API under /api and, in production, the built web app. It
// lives for as long as its layer, so it starts with the app and stops when the app quits.

// Dev serves the API on a fixed port because Vite's proxy (apps/web/vite.config.ts) points at it.
const DEV_API_PORT = Number(process.env.FERN_API_PORT ?? 7420);
const DEV_WEB_URL = "http://localhost:5173";

// The API with Fern's database and its Sessions' worktrees, kept with the app's other data (ADR
// 0004, ADR 0005). Built once the app is ready, which is when Electron can say where that is.
const Api = Layer.unwrap(
  Effect.sync(() => {
    const data = app.getPath("userData");
    return ApiLive.pipe(
      Layer.provide([
        DatabaseLive(path.join(data, "fern.db")),
        Layer.succeed(WorktreesDir, { dir: data }),
      ]),
    );
  }),
);

const serve = <E, R>(port: number, routes: Layer.Layer<never, E, R>) =>
  HttpRouter.serve(routes).pipe(
    Layer.provideMerge(
      NodeHttpServer.layer(createServer, { port, host: "127.0.0.1" }),
    ),
  );

// The URL the window should load.
export class AppServer extends Context.Service<
  AppServer,
  { readonly url: string }
>()("desktop/AppServer") {
  // Dev: the API here, the page from `vite` (started by turbo alongside Electron).
  static readonly layerDev = Layer.succeed(
    AppServer,
    AppServer.of({ url: DEV_WEB_URL }),
  ).pipe(Layer.provideMerge(serve(DEV_API_PORT, Api)));

  // Production: the API and the built web app from one server on a free port.
  static readonly layer = Layer.effect(
    AppServer,
    Effect.gen(function* () {
      const server = yield* HttpServer.HttpServer;
      const url = HttpServer.formatAddress(server.address);
      yield* Effect.logInfo(`Fern server ready at ${url}`);
      return AppServer.of({ url });
    }),
  ).pipe(
    Layer.provide(
      serve(
        0,
        Layer.mergeAll(
          Api,
          HttpStaticServer.layer({
            root: app.isPackaged
              ? path.join(process.resourcesPath, "web")
              : path.join(import.meta.dirname, "../../web/dist"),
            spa: true,
          }),
        ),
      ),
    ),
  );
}
