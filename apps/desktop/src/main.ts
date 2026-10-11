import { NodeRuntime } from "@effect/platform-node";
import { app } from "electron";
import { Effect, Runtime } from "effect";
import { AppServer } from "./AppServer";
import { runMainWindow } from "./MainWindow";

const isDev = process.argv.includes("--dev");

const onAllClosed = () =>
  process.platform === "darwin" ? undefined : app.quit();

// Resolves when the user quits (Cmd+Q, or the last window closing on Windows/Linux). Quitting is
// deferred so the program's scope can close first, which tears down windows and the server.
const waitForQuit = Effect.callback<void>((resume) => {
  const onWillQuit = (event: Electron.Event) => {
    event.preventDefault();
    resume(Effect.void);
  };
  app.once("will-quit", onWillQuit);
  app.on("window-all-closed", onAllClosed);
  return Effect.sync(() => {
    app.off("will-quit", onWillQuit);
    app.off("window-all-closed", onAllClosed);
  });
});

const AppLayer = isDev ? AppServer.layerDev : AppServer.layer;

const program = Effect.gen(function* () {
  yield* runMainWindow;
  yield* waitForQuit;
}).pipe(
  Effect.scoped,
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- this is the entry point
  Effect.provide(AppLayer),
);

// Electron APIs need the app to be ready before any layer is built.
NodeRuntime.runMain(
  Effect.promise(() => app.whenReady()).pipe(Effect.andThen(program)),
  {
    teardown: (exit, onExit) =>
      Runtime.defaultTeardown(exit, (code) => (onExit(code), app.exit(code))),
  },
);
