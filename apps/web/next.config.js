import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained server bundle that the Electron app boots in production.
  output: "standalone",
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  transpilePackages: ["@repo/api", "@repo/server"],
};

export default nextConfig;
