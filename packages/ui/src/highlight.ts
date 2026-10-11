import { type BundledLanguage, bundledLanguages } from "shiki";

// A line as runs of text, each with its color; plain text has none.
export type Token = readonly [content: string, color: string | undefined];
export type Line = ReadonlyArray<Token>;

export interface HighlightRequest {
  readonly id: number;
  readonly content: string;
  readonly language: BundledLanguage;
}
export interface HighlightResponse {
  readonly id: number;
  readonly lines: ReadonlyArray<Line> | undefined;
}

const isBundled = (name: string): name is BundledLanguage =>
  Object.hasOwn(bundledLanguages, name);

// Shiki's language for a file, from its name; undefined when Shiki doesn't know it.
export const languageOf = (path: string): BundledLanguage | undefined => {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  const ext = name.includes(".") ? name.split(".").at(-1) : undefined;
  const guess =
    name === "dockerfile"
      ? "docker"
      : name === "makefile"
        ? "make"
        : ext === "mjs" || ext === "cjs"
          ? "js"
          : ext === "mts" || ext === "cts"
            ? "ts"
            : ext;
  return guess && isBundled(guess) ? guess : undefined;
};

// Past this, the tokens cost more to copy back from the worker and hold than they're worth.
const MAX_HIGHLIGHT_CHARS = 300_000;

let worker: Worker | undefined;
let nextId = 0;
const waiting = new Map<
  number,
  (lines: ReadonlyArray<Line> | undefined) => void
>();

const start = () => {
  const started = new Worker(
    new URL("./highlight.worker.ts", import.meta.url),
    {
      type: "module",
    },
  );
  started.addEventListener(
    "message",
    (event: MessageEvent<HighlightResponse>) => {
      waiting.get(event.data.id)?.(event.data.lines);
      waiting.delete(event.data.id);
    },
  );
  return started;
};

// A file's content as highlighted lines, tokenized off the main thread; undefined for a
// language Shiki doesn't know or a file too long to highlight.
export const highlight = (
  path: string,
  content: string,
): Promise<ReadonlyArray<Line> | undefined> => {
  const language = languageOf(path);
  if (language === undefined || content.length > MAX_HIGHLIGHT_CHARS)
    return Promise.resolve(undefined);
  worker ??= start();
  const id = nextId++;
  const request: HighlightRequest = { id, content, language };
  // A Worker's postMessage has no target origin; the rule is for window.postMessage.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  worker.postMessage(request);
  return new Promise((resolve) => waiting.set(id, resolve));
};
