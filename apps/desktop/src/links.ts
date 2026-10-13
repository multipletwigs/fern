// The schemes the developer's own apps may be handed: web pages and mail. Any other, a file, a
// share, an app's own protocol, could run or reveal something the moment the OS opens it.
const EXTERNAL = new Set(["http:", "https:", "mailto:"]);

// Where a link the window is asked to open or navigate to goes: stays in the window when it's
// Fern's own page at `app`, by origin rather than by how its text starts, goes to the developer's
// browser or mail app when it's a web or mail link, or goes nowhere.
export const linkAction = (
  target: string,
  app: string,
): "app" | "external" | "drop" => {
  if (!URL.canParse(target)) return "drop";
  const url = new URL(target);
  if (url.origin === new URL(app).origin) return "app";
  return EXTERNAL.has(url.protocol) ? "external" : "drop";
};
