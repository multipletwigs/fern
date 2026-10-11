import { createHighlighter } from "shiki";
import type { HighlightRequest, HighlightResponse } from "./highlight";

// Tokenizing a long file takes long enough to freeze the page, so it runs here, off the main
// thread. Each language loads once, on first use.
const THEME = "github-dark";
const highlighter = createHighlighter({ themes: [THEME], langs: [] });

addEventListener("message", (event: MessageEvent<HighlightRequest>) => {
  const { id, content, language } = event.data;
  void highlighter
    .then(async (loaded) => {
      await loaded.loadLanguage(language);
      const lines = loaded
        .codeToTokens(content, { lang: language, theme: THEME })
        .tokens.map((line) =>
          line.map((token) => [token.content, token.color] as const),
        );
      postMessage({ id, lines } satisfies HighlightResponse);
    })
    .catch(() =>
      postMessage({ id, lines: undefined } satisfies HighlightResponse),
    );
});
