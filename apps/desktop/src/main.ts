import { app, BrowserWindow, shell, utilityProcess, type UtilityProcess } from "electron";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

const DEV_URL = "http://localhost:3000";
const isDev = process.argv.includes("--dev");

let nextServer: UtilityProcess | undefined;

// Packaged: copied into Resources by electron-builder. Unpackaged: the web app's build output.
const standaloneDir = app.isPackaged
  ? path.join(process.resourcesPath, "web")
  : path.join(import.meta.dirname, "../../web/.next/standalone");

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

const waitForServer = async (url: string, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`Next.js server did not start at ${url}`);
};

const startNextServer = async () => {
  const serverPath = path.join(standaloneDir, "apps/web/server.js");
  if (!existsSync(serverPath)) {
    throw new Error(`Missing ${serverPath}. Run \`pnpm build\` first.`);
  }
  const port = await freePort();
  nextServer = utilityProcess.fork(serverPath, [], {
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1" },
    stdio: "inherit",
  });
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url);
  return url;
};

const createWindow = async () => {
  const url = isDev ? DEV_URL : await startNextServer();
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: { contextIsolation: true, sandbox: true },
  });

  // Keep external links in the user's browser instead of inside the app.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!target.startsWith(url)) void shell.openExternal(target);
    return { action: "deny" };
  });

  await win.loadURL(url);
};

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => nextServer?.kill());
