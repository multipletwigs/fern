import type { CitedDecision, Section, Walkthrough } from "@repo/api";

// GitHub's own limit on a PR's description.
export const MAX_DESCRIPTION = 65_536;

const CUT = "_The rest of this Walkthrough is in Fern._";

// On one line, for a list item or a Risk's reason.
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

const answerOf = (decision: CitedDecision) =>
  [decision.choice, decision.freeText]
    .filter((part) => part !== undefined && part.trim() !== "")
    .map((part) => oneLine(part ?? ""))
    .join(". ");

const sectionOf = (section: Section) => {
  const decisions =
    section.decisions.length > 0
      ? [
          "**Decisions**",
          section.decisions
            .map(
              (d) =>
                `- **${oneLine(d.question)}** Answer: ${answerOf(d) || "none recorded"}`,
            )
            .join("\n"),
        ]
      : section.unplanned
        ? ["**Unplanned:** this Section cites no Decision."]
        : [];
  return [
    `## ${oneLine(section.title)}`,
    ...(section.risk
      ? [`**Risk: ${section.risk.level}.** ${oneLine(section.risk.reason)}`]
      : []),
    section.explanation.trim(),
    ...decisions,
  ].join("\n\n");
};

// As many whole Sections as fit in `room`, then a pointer to the rest; a single Section that's too
// long on its own is cut short.
const cut = (sections: ReadonlyArray<string>, room: number) => {
  const space = room - CUT.length - 2;
  const kept: Array<string> = [];
  let length = 0;
  for (const section of sections) {
    const next = length + (kept.length > 0 ? 2 : 0) + section.length;
    if (next > space) break;
    kept.push(section);
    length = next;
  }
  const shown =
    kept.length > 0 ? kept.join("\n\n") : (sections[0] ?? "").slice(0, space);
  return `${shown.trimEnd()}\n\n${CUT}`;
};

// A PR's description, rendered from its Walkthrough (ADR 0009): each Section's title, Risk, prose
// and cited Decisions, as the developer answered them, but no hunks, so it reads as a guide to the
// diff GitHub shows below it. Then how many changes no Section explains, and the line that closes
// the PR's ticket.
export const prDescription = (walkthrough: Walkthrough) => {
  const unexplained = walkthrough.unexplained.length;
  const footer = [
    ...(unexplained > 0
      ? [
          `${unexplained} ${unexplained === 1 ? "change" : "changes"} no Section explains.`,
        ]
      : []),
    ...(walkthrough.pr?.ticket === undefined
      ? []
      : [`Closes #${walkthrough.pr.ticket}`]),
  ].join("\n\n");
  const tail = footer === "" ? "" : `\n\n---\n\n${footer}`;
  const sections = walkthrough.sections.map(sectionOf);
  const body = sections.join("\n\n");
  const room = MAX_DESCRIPTION - tail.length - 1;
  return `${body.length <= room ? body : cut(sections, room)}${tail}\n`;
};
