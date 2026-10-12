import type { Project, SessionSummary, VerifySlot } from "@repo/api";

const within = (path: string, folder: string) =>
  path === folder || path.startsWith(`${folder}/`);

// The Session a Verify slot belongs to: one run in a worktree Fern made, where the slot runs from
// the same folder, a folder around it, or one inside it, as when the Session's agent made a
// worktree of its own in there. The innermost Session wins; between equals, the one Fern made the
// worktree for.
export const slotSession = (
  projects: ReadonlyArray<Project>,
  slot: VerifySlot,
): SessionSummary | undefined =>
  projects
    .flatMap((project) => project.sessions)
    .flatMap((session) =>
      session.worktree !== undefined &&
      (within(slot.worktree, session.worktree) ||
        within(session.worktree, slot.worktree))
        ? [{ session, depth: session.worktree.length }]
        : [],
    )
    .toSorted(
      (a, b) =>
        b.depth - a.depth ||
        Number(b.session.ownWorktree === true) -
          Number(a.session.ownWorktree === true),
    )[0]?.session;
