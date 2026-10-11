import { FernApi } from "@repo/api";
import { app, utilityProcess } from "electron";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schedule,
  Schema,
} from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { createServer } from "node:net";

export class NextServerError extends Schema.TaggedError<NextServerError>()(
  "NextServerError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

const freePort = Effect.callback<number, NextServerError>((resume) => {
  const server = createServer();
  server.once("error", (cause) =>
    resume(
      Effect.fail(new NextServerError({ message: "No free port", cause })),
    ),
  );
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    server.close(() => resume(Effect.succeed(port)));
  });
});

// Poll the API's health endpoint through the typed client until the server answers.
const waitUntilHealthy = Effect.fn("NextServer.waitUntilHealthy")(function* (
  url: string,
) {
  const client = yield* HttpApiClient.make(FernApi, { baseUrl: url });
  yield* client.health().pipe(
    Effect.retry(Schedule.spaced("100 millis")),
    Effect.timeout("20 seconds"),
    Effect.mapError(
      (cause) =>
        new NextServerError({ message: `Not healthy at ${url}`, cause }),
    ),
  );
});

// The URL of the Next.js server the window should load.
export class NextServer extends Context.Service<
  NextServer,
  { readonly url: string }
>()("desktop/NextServer") {
  // Dev: `next dev`, started by turbo alongside Electron.
  static readonly layerDev = Layer.succeed(
    NextServer,
    NextServer.of({ url: "http://localhost:3000" }),
  );

  // Production: boot the standalone server in a utility process for as long as the layer lives.
  static readonly layer = Layer.effect(
    NextServer,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const standaloneDir = app.isPackaged
        ? path.join(process.resourcesPath, "web")
        : path.join(import.meta.dirname, "../../web/.next/standalone");
      const serverPath = path.join(standaloneDir, "apps/web/server.js");

      if (!(yield* fs.exists(serverPath).pipe(Effect.orDie))) {
        return yield* new NextServerError({
          message: `Missing ${serverPath}. Run \`pnpm build\` first.`,
        });
      }

      const port = yield* freePort;
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          utilityProcess.fork(serverPath, [], {
            env: {
              ...process.env,
              NODE_ENV: "production",
              PORT: String(port),
              HOSTNAME: "127.0.0.1",
            },
            stdio: "inherit",
          }),
        ),
        (child) => Effect.sync(() => child.kill()),
      );

      const url = `http://127.0.0.1:${port}`;
      yield* waitUntilHealthy(url);
      yield* Effect.logInfo(`Next.js server ready at ${url}`);
      return NextServer.of({ url });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}
