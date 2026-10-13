import { assert, describe, it } from "@effect/vitest";
import { CitedDecision, PullRequest, Section, Walkthrough } from "@repo/api";
import { DateTime } from "effect";
import {
  MAX_DESCRIPTION,
  prDescription,
} from "../src/walkthrough/prDescription";

const section = (fields: Partial<Section> & { title: string }) =>
  Section.make({
    id: "s1",
    explanation: "Explains it.",
    decisions: [],
    unplanned: false,
    hunks: [],
    ...fields,
  });

const walkthrough = (
  sections: ReadonlyArray<Section>,
  pr?: { ticket?: number },
  number = 1,
) =>
  Walkthrough.make({
    id: `w${number}`,
    sessionId: "session",
    number,
    status: "ready",
    since: "pr",
    pr: pr
      ? PullRequest.make({
          number: 7,
          url: "https://github.com/acme/app/pull/7",
          title: "A PR",
          position: 1,
          ticket: pr.ticket,
        })
      : undefined,
    createdAt: DateTime.makeUnsafe(0),
    overlapping: [],
    sections,
    unexplained: [],
  });

// The `number`th Walkthrough of a PR, with a thousand Sections.
const longWalkthrough = (number: number) =>
  walkthrough(
    Array.from({ length: 1000 }, (_, i) =>
      section({
        id: `s${i}`,
        title: `Section ${number}.${i}`,
        explanation: "x".repeat(40),
      }),
    ),
    {},
    number,
  );

describe("prDescription", () => {
  it("quotes the developer's own words alone, and keeps a cited question on one line", () => {
    const body = prDescription([
      walkthrough(
        [
          section({
            title: "Toggle",
            decisions: [
              CitedDecision.make({
                id: "d1",
                sessionId: "session",
                question: "Where does\n  the toggle live?",
                recommendation: "Top bar",
                freeText: "Next to the font size",
              }),
            ],
          }),
        ],
        { ticket: 9 },
      ),
    ]);
    assert.strictEqual(
      body,
      "## Toggle\n\nExplains it.\n\n**Decisions**\n\n- **Where does the toggle live?** Answer: Next to the font size\n\n---\n\nCloses #9\n",
    );
  });

  it("a PR without a ticket closes nothing, and a Section written before Risk and citations shows neither", () => {
    assert.strictEqual(
      prDescription([walkthrough([section({ title: "Old" })], {})]),
      "## Old\n\nExplains it.\n",
    );
  });

  it("a Walkthrough longer than GitHub allows keeps only the Sections that fit, still closing its ticket", () => {
    const long = Array.from({ length: 2000 }, (_, i) =>
      section({
        id: `s${i}`,
        title: `Section ${i}`,
        explanation: "x".repeat(40),
      }),
    );
    const body = prDescription([walkthrough(long, { ticket: 3 })]);
    assert.isAtMost(body.length, MAX_DESCRIPTION);
    assert.match(
      body,
      /x\n\n_The rest of this Walkthrough is in Fern\._\n\n---\n\nCloses #3\n$/,
    );
  });

  it("a PR with several Walkthroughs is described by all of them, oldest first, each under a heading of its own", () => {
    assert.strictEqual(
      prDescription([
        walkthrough([section({ title: "First this" })], {}),
        walkthrough([section({ title: "Then this" })], {}, 2),
      ]),
      "# Walkthrough 1\n\n## First this\n\nExplains it.\n\n# Walkthrough 2\n\n## Then this\n\nExplains it.\n",
    );
  });

  it("several Walkthroughs longer than GitHub allows keep the oldest Sections that fit", () => {
    const body = prDescription([longWalkthrough(1), longWalkthrough(2)]);
    assert.isAtMost(body.length, MAX_DESCRIPTION);
    assert.isTrue(body.startsWith("# Walkthrough 1\n\n## Section 1.0\n"));
    assert.include(body, "## Section 1.999");
    assert.match(body, /_The rest of this Walkthrough is in Fern\._\n$/);
  });
});
