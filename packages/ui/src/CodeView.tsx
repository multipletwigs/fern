import { useEffect, useMemo, useState } from "react";
import {
  type BundledLanguage,
  bundledLanguages,
  createHighlighter,
  type Highlighter,
} from "shiki";

const isBundled = (name: string): name is BundledLanguage =>
  Object.hasOwn(bundledLanguages, name);

// Shiki's language for a file, from its name; plain text when Shiki doesn't know it.
const languageOf = (path: string): BundledLanguage | "text" => {
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
  return guess && isBundled(guess) ? guess : "text";
};

const THEME = "github-dark";
// Tokenizing runs on every change, so very large files stay plain to keep typing smooth.
const MAX_HIGHLIGHT_CHARS = 300_000;

// One highlighter for every file. Each language loads once; after that, tokenizing is
// synchronous, so a file changing on disk never renders a plain-text frame in between.
const highlighter = createHighlighter({ themes: [THEME], langs: [] });

const plain = (content: string) =>
  content.split("\n").map((text) => [{ content: text, color: undefined }]);

// A file's content with line numbers and syntax highlighting.
export function CodeView({ path, content }: { path: string; content: string }) {
  const language = languageOf(path);
  const [ready, setReady] = useState<{
    highlighter: Highlighter;
    language: string;
  }>();

  useEffect(() => {
    let cancelled = false;
    void highlighter
      .then(async (loaded) => {
        if (language !== "text") await loaded.loadLanguage(language);
        if (!cancelled) setReady({ highlighter: loaded, language });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [language]);

  const lines = useMemo(
    () =>
      ready?.language === language &&
      language !== "text" &&
      content.length <= MAX_HIGHLIGHT_CHARS
        ? ready.highlighter.codeToTokens(content, {
            lang: language,
            theme: THEME,
          }).tokens
        : plain(content),
    [ready, language, content],
  );
  const gutter = String(lines.length).length;

  return (
    <div className="h-full overflow-auto">
      <pre className="min-w-max py-3 font-mono text-[12.5px] leading-5">
        {lines.map((line, index) => (
          <div
            // Lines are positional; nothing else identifies them.
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            className="flex hover:bg-white/[0.025]"
          >
            <span
              className="sticky left-0 shrink-0 bg-[#0a0a0a] pr-4 pl-4 text-right text-faint select-none"
              style={{ width: `${gutter + 3}ch` }}
            >
              {index + 1}
            </span>
            <span className="pr-6 whitespace-pre text-ink/90">
              {line.map((token, at) => (
                <span
                  // oxlint-disable-next-line react/no-array-index-key
                  key={at}
                  style={token.color ? { color: token.color } : undefined}
                >
                  {token.content}
                </span>
              ))}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}
