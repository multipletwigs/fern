import { defineConfig } from "tsdown";

// Bundle the main process (Effect included) into one file. The Agent SDK stays external: it finds
// its native Claude Code binary relative to its own install, so it ships in node_modules. So does
// node-pty, which loads its native addon and spawn-helper from its own folder.
export default defineConfig({
  entry: ["src/main.ts"],
  platform: "node",
  format: "esm",
  outDir: "dist",
  deps: {
    neverBundle: ["electron", "@anthropic-ai/claude-agent-sdk", "node-pty"],
    onlyBundle: false,
  },
});
