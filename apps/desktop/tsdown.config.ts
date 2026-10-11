import { defineConfig } from "tsdown";

// Bundle the main process (Effect included) into one file so the packaged app needs no node_modules.
export default defineConfig({
  entry: ["src/main.ts"],
  platform: "node",
  format: "esm",
  outDir: "dist",
  deps: { neverBundle: ["electron"], onlyBundle: false },
});
