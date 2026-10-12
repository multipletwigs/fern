import { assert, it } from "@effect/vitest";
import { Project, SessionSummary, VerifySlot } from "@repo/api";
import { DateTime } from "effect";
import { slotSession } from "../src/verify/slotSession";

const at = DateTime.makeUnsafe(0);

const session = (
  id: string,
  worktree: string | undefined,
  ownWorktree?: boolean,
) =>
  SessionSummary.make({
    id,
    title: id,
    worktree,
    ownWorktree,
    lastActivityAt: at,
  });

const slot = (worktree: string) =>
  VerifySlot.make({
    slot: 8,
    worktree,
    branch: "b",
    apiPort: 7438,
    webPort: 5188,
    pageUrl: "http://localhost:5188",
    processes: [],
    startedAt: at,
  });

const W = "/data/worktrees/fern/fix-it-a1b2c3";

const sessions = [
  session("checkout", undefined),
  session("terminal", W),
  session("hosted", W, true),
  session("elsewhere", "/data/worktrees/fern/other-d4e5f6", true),
];
const projects = [Project.make({ path: "/code/fern", sessions })];

it("matches the Session Fern made the slot's worktree for", () => {
  assert.strictEqual(slotSession(projects, slot(W))?.id, "hosted");
});

it("matches a slot run from a worktree an agent made inside the Session's", () => {
  assert.strictEqual(
    slotSession(projects, slot(`${W}/.claude/worktrees/agent-1`))?.id,
    "hosted",
  );
});

it("prefers the innermost Session", () => {
  const inner = `${W}/.claude/worktrees/agent-1`;
  const withInner = [
    Project.make({
      path: "/code/fern",
      sessions: [...sessions, session("inner", inner)],
    }),
  ];
  assert.strictEqual(slotSession(withInner, slot(inner))?.id, "inner");
});

it("matches a Session in the Project's folder inside the slot's worktree", () => {
  const sub = [
    Project.make({
      path: "/code/mono/apps/web",
      sessions: [session("sub", `${W}/apps/web`, true)],
    }),
  ];
  assert.strictEqual(slotSession(sub, slot(W))?.id, "sub");
});

it("matches nothing for a slot outside every Session's worktree", () => {
  assert.strictEqual(
    slotSession(projects, slot("/code/fern/.claude/worktrees/agent-2")),
    undefined,
  );
  // A folder whose name only starts the same.
  assert.strictEqual(slotSession(projects, slot(`${W}-old`)), undefined);
});
