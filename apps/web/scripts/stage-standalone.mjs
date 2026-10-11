// `next build` leaves static assets out of the standalone bundle; copy them in.
import { cpSync, existsSync } from "node:fs";
import path from "node:path";

const web = path.resolve(import.meta.dirname, "..");
const target = path.join(web, ".next/standalone/apps/web");

cpSync(path.join(web, ".next/static"), path.join(target, ".next/static"), { recursive: true });
if (existsSync(path.join(web, "public"))) {
  cpSync(path.join(web, "public"), path.join(target, "public"), { recursive: true });
}
