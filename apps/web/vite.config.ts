import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev the Electron main process serves the API (see apps/desktop/src/AppServer.ts); Vite
// forwards /api to it so the page can use relative URLs, exactly as it does in production.
const apiPort = process.env.FERN_API_PORT ?? "7420";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Loaded from local disk by Electron, so large chunks (Shiki grammars, Mermaid) cost little.
  build: { chunkSizeWarningLimit: 2000 },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
  },
});
