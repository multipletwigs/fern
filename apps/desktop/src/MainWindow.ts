import { app, BrowserWindow, shell } from "electron";
import { Effect, Queue, Stream } from "effect";
import { NextServer } from "./NextServer";

const openWindow = Effect.fn("MainWindow.open")(function* (url: string) {
  const win = yield* Effect.acquireRelease(
    Effect.sync(
      () =>
        new BrowserWindow({
          width: 1200,
          height: 800,
          webPreferences: { contextIsolation: true, sandbox: true },
        }),
    ),
    (created) =>
      Effect.sync(() =>
        created.isDestroyed() ? undefined : created.destroy(),
      ),
  );

  // Keep external links in the user's browser instead of inside the app.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!target.startsWith(url)) void shell.openExternal(target);
    return { action: "deny" };
  });

  yield* Effect.promise(() => win.loadURL(url));
});

// macOS re-opens a window when the dock icon is clicked and none are open.
const activations = Stream.callback<void>(
  Effect.fn(function* (queue) {
    const onActivate = () => Queue.offerUnsafe(queue, undefined);
    yield* Effect.acquireRelease(
      Effect.sync(() => app.on("activate", onActivate)),
      () => Effect.sync(() => app.off("activate", onActivate)),
    );
  }),
);

// Opens the main window and keeps one available until the surrounding scope closes.
export const runMainWindow = Effect.gen(function* () {
  const { url } = yield* NextServer;
  yield* openWindow(url);
  yield* activations.pipe(
    Stream.filter(() => BrowserWindow.getAllWindows().length === 0),
    Stream.runForEach(() => openWindow(url)),
    Effect.forkScoped,
  );
});
