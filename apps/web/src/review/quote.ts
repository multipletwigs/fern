import type { ReviewQueueItem } from "./queue";

// A passage highlighted in the Review tab, and which item it's from.
export interface ReviewQuote {
  readonly about: string;
  readonly text: string;
}

export const quoteAbout = (item: ReviewQueueItem) => {
  const walkthrough = `Walkthrough ${item.walkthrough.number}`;
  if (item.kind === "section") return `${walkthrough}, “${item.section.title}”`;
  if (item.kind === "unexplained")
    return `${walkthrough}, the unexplained change in ${item.change.hunk.path}`;
  return walkthrough;
};

// The message Claude gets: where the passage is from, the passage quoted, then what was asked.
export const withQuote = (quote: ReviewQuote, text: string) =>
  [
    `About ${quote.about}:`,
    quote.text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n"),
    text,
  ]
    .filter((part) => part !== "")
    .join("\n\n");
