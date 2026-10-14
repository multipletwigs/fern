import {
  type DiffSide,
  type Hunk,
  PrReviewComment,
  type PrReviewEvent,
  type Walkthrough,
} from "@repo/api";
import type { EarlierRejection } from "../walkthrough/Walkthroughs";

// The review a Foreign PR's Reviewed Walkthrough posts on GitHub: each Rejection listed in its
// body, those of the earlier Walkthroughs it follows on from that never went up included, and each
// of its own Sections' notes again on the Section's first changed line. Approved items post
// nothing.

// Control characters, but for line breaks and tabs: nothing anyone typed on purpose.
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/gu;

// The developer's note, as they wrote it, Markdown and mentions included.
const noteText = (note: string | undefined) =>
  (note ?? "").replace(CONTROL, "").trim();

// Text the writer wrote, or a path from the PR, as one line of inline code: GitHub renders nothing
// in it, no link, image, mention or heading, whatever it holds.
const code = (text: string) => {
  const flat = text
    .replace(CONTROL, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 200);
  const longest = Math.max(
    0,
    ...(flat.match(/`+/gu) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(longest + 1);
  return longest === 0
    ? `${fence}${flat}${fence}`
    : `${fence} ${flat} ${fence}`;
};

// The header's start lines, as in "@@ -12,3 +12,4 @@".
const HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;

// Where the hunk's first changed line is, on the side of the diff it's on: a line it adds on the
// PR's side, or a line it removes on the side it was on. With `addedOnly`, only a line it adds.
const firstChange = (
  hunk: Hunk,
  addedOnly: boolean,
): { line: number; side: DiffSide } | undefined => {
  const found = HEADER.exec(hunk.header);
  if (!found) return undefined;
  let left = Number(found[1]);
  let right = Number(found[2]);
  for (const line of hunk.lines) {
    if (line.startsWith("+")) return { line: right, side: "RIGHT" };
    if (line.startsWith("-")) {
      if (!addedOnly) return { line: left, side: "LEFT" };
      left++;
    } else if (line.startsWith(" ")) {
      left++;
      right++;
    }
  }
  return undefined;
};

const indented = (text: string) =>
  text
    .split("\n")
    .map((line) => (line === "" ? "" : `   ${line}`))
    .join("\n");

// What an earlier Walkthrough's Rejection is called in the body.
const earlierTitle = (rejection: EarlierRejection) =>
  `${
    rejection.path === undefined
      ? code(rejection.title ?? "")
      : `Unexplained change in ${code(rejection.path)}`
  } (from Walkthrough ${rejection.walkthrough})`;

export const reviewOf = (
  walkthrough: Walkthrough,
  // The PR is the developer's own, which GitHub won't let them approve or request changes on.
  own: boolean,
  // The Rejections it carries from the earlier Walkthroughs it follows on from: in the body only,
  // as their lines may have moved since.
  earlier: ReadonlyArray<EarlierRejection>,
): {
  readonly event: PrReviewEvent;
  readonly body: string;
  readonly comments: ReadonlyArray<PrReviewComment>;
} => {
  const sections = walkthrough.sections.filter(
    (s) => s.verdict?.kind === "rejected",
  );
  const unexplained = walkthrough.unexplained.filter(
    (u) => u.verdict?.kind === "rejected",
  );
  const rejected = [
    ...sections.map((s) => ({
      title: code(s.title),
      note: noteText(s.verdict?.note),
    })),
    ...unexplained.map((u) => ({
      title: `Unexplained change in ${code(u.hunk.path)}`,
      note: noteText(u.verdict?.note),
    })),
    ...earlier.map((r) => ({ title: earlierTitle(r), note: noteText(r.note) })),
  ];
  // A Walkthrough of the PR's newest commits alone numbers the lines it removes as they were
  // before those commits, not as the PR's base has them, so its notes go only on lines it adds.
  const addedOnly = walkthrough.since === "previous";
  const comments = sections.flatMap((s) => {
    const [hunk] = s.hunks;
    const at = hunk && firstChange(hunk, addedOnly);
    return hunk && at
      ? [
          PrReviewComment.make({
            path: hunk.path,
            ...at,
            body: noteText(s.verdict?.note),
          }),
        ]
      : [];
  });
  return {
    event: own
      ? "COMMENT"
      : rejected.length === 0
        ? "APPROVE"
        : "REQUEST_CHANGES",
    body:
      rejected.length === 0
        ? "Reviewed in Fern: every change approved."
        : [
            "Reviewed in Fern. Rejected:",
            ...rejected.map(
              (r, index) => `\n${index + 1}. ${r.title}\n\n${indented(r.note)}`,
            ),
          ].join("\n"),
    comments,
  };
};
