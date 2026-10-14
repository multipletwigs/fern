import { Effect, Layer, Option, Stream } from "effect";
import { Autonomy } from "../src/autonomy/Autonomy";
import { CodeHost } from "../src/codehost/CodeHost";
import { PullRequests } from "../src/pullrequest/PullRequests";
import { Commands } from "../src/commands/Commands";
import { Flows } from "../src/flow/Flows";
import { IssueTracker, type TrackedIssue } from "../src/issue/IssueTracker";
import { ProjectSettings } from "../src/project/ProjectSettings";
import { Rounds } from "../src/round/Rounds";
import { StackEligibility } from "../src/stack/StackEligibility";
import { Stacks } from "../src/stack/Stacks";
import { Subagents } from "../src/subagent/Subagents";
import { Terminals } from "../src/terminal/Terminals";
import { Tools } from "../src/tools/Tools";
import { Transcripts } from "../src/transcript/Transcripts";
import { Turns } from "../src/turn/Turns";
import { VerifySlots } from "../src/verify/VerifySlots";
import { Walkthroughs } from "../src/walkthrough/Walkthroughs";
import { WalkthroughWriter } from "../src/walkthrough/WalkthroughWriter";
import { Workspace } from "../src/workspace/Workspace";
import { WorktreeCleanup } from "../src/worktree/WorktreeCleanup";
import { Worktrees, WorktreesDir } from "../src/worktree/Worktrees";

// Services a test doesn't exercise; using one fails the test.

export const NoWriter = Layer.succeed(
  WalkthroughWriter,
  WalkthroughWriter.of({
    write: () => Effect.die("unused"),
    explore: () => Effect.die("unused"),
  }),
);

export const UnusedTranscripts = Layer.succeed(
  Transcripts,
  Transcripts.of({
    current: Effect.die("unused"),
    projects: Stream.die("unused"),
    folder: () => Effect.die("unused"),
    live: () => Effect.die("unused"),
  }),
);

export const UnusedSubagents = Layer.succeed(
  Subagents,
  Subagents.of({
    list: () => Effect.die("unused"),
    live: () => Effect.die("unused"),
    read: () => Effect.die("unused"),
    close: () => Effect.die("unused"),
    reopen: () => Effect.die("unused"),
  }),
);

export const unusedTurns = Turns.of({
  send: () => Effect.die("unused"),
  unqueue: () => Effect.die("unused"),
  start: () => Effect.die("unused"),
  interrupt: () => Effect.die("unused"),
  close: () => Effect.die("unused"),
  turn: () => Effect.die("unused"),
  isOpen: () => Effect.die("unused"),
  contextWindow: () => Effect.die("unused"),
  running: Effect.die("unused"),
  overlapping: () => Effect.die("unused"),
  finished: Stream.never,
});

export const UnusedCommands = Layer.succeed(
  Commands,
  Commands.of({ list: () => Effect.die("unused") }),
);

export const UnusedProjectSettings = Layer.succeed(
  ProjectSettings,
  ProjectSettings.of({
    of: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    save: () => Effect.die("unused"),
  }),
);

export const UnusedWorkspace = Layer.succeed(
  Workspace,
  Workspace.of({
    files: () => Effect.die("unused"),
    file: () => Effect.die("unused"),
    changes: () => Effect.die("unused"),
  }),
);

export const UnusedWalkthroughs = Layer.succeed(
  Walkthroughs,
  Walkthroughs.of({
    list: () => Stream.die("unused"),
    write: () => Effect.die("unused"),
    writePr: () => Effect.die("unused"),
    verdict: () => Effect.die("unused"),
    redirect: () => Effect.die("unused"),
    rewrite: () => Effect.die("unused"),
    listForeign: () => Stream.die("unused"),
    writeForeign: () => Effect.die("unused"),
    foreignStates: () => Effect.die("unused"),
    lastWritten: () => Effect.die("unused"),
    liveForeignStates: () => Stream.die("unused"),
    foreign: () => Effect.die("unused"),
    reviewPosted: () => Effect.die("unused"),
    reviewRefused: () => Effect.die("unused"),
    openRejections: () => Effect.die("unused"),
  }),
);

const unusedStacks = Stacks.of({
  prs: () => Effect.die("unused"),
  landsAsStack: () => Effect.die("unused"),
  landsAsOnePr: () => Effect.die("unused"),
  write: () => Effect.die("unused"),
  onePrWaits: () => Effect.die("unused"),
  landed: () => Effect.die("unused"),
  land: () => Effect.die("unused"),
  merged: () => Effect.die("unused"),
});

export const UnusedStacks = Layer.succeed(Stacks, unusedStacks);

// No Session's work lands as a Stack, so every Walkthrough asked for is a snapshot's.
export const SnapshotsOnly = Layer.effect(
  Stacks,
  Effect.gen(function* () {
    const walkthroughs = yield* Walkthroughs;
    return Stacks.of({
      ...unusedStacks,
      write: (sessionId) => walkthroughs.write(sessionId),
    });
  }),
);

// No Session's work lands as a Stack.
export const NoStacks = Layer.succeed(
  StackEligibility,
  StackEligibility.of({
    applies: () => Effect.succeed(false),
    trunk: () => Effect.succeedNone,
  }),
);

// A code host never asked for a repo's PRs, as no test using it opens a Pull requests page.
export const NotListing = {
  login: () => Effect.die("unused"),
  pullRequests: () => Effect.die("unused"),
  stacks: () => Effect.die("unused"),
  pullRequest: () => Effect.die("unused"),
  fetchPullRequest: () => Effect.die("unused"),
  issue: () => Effect.die("unused"),
  commitsAhead: () => Effect.die("unused"),
  pullRequestDiff: () => Effect.die("unused"),
  postReview: () => Effect.die("unused"),
};

// A code host Fern never asks, where no Session's work lands as a Stack.
export const UnusedCodeHost = Layer.succeed(
  CodeHost,
  CodeHost.of({
    ready: () => Effect.die("unused"),
    defaultBranch: () => Effect.die("unused"),
    push: () => Effect.die("unused"),
    openDraft: () => Effect.die("unused"),
    link: () => Effect.die("unused"),
    setBody: () => Effect.die("unused"),
    markReady: () => Effect.die("unused"),
    merge: () => Effect.die("unused"),
    state: () => Effect.die("unused"),
    ...NotListing,
  }),
);

// Somewhere no worktree can be made.
export const NoWorktreesDir = Layer.succeed(WorktreesDir, {
  dir: "/nonexistent/fern-worktrees",
});

export const UnusedWorktrees = Layer.succeed(
  Worktrees,
  Worktrees.of({
    branchable: () => Effect.die("unused"),
    create: () => Effect.die("unused"),
    isMerged: () => Effect.die("unused"),
    isDirty: () => Effect.die("unused"),
    remove: () => Effect.die("unused"),
  }),
);

export const UnusedVerifySlots = Layer.succeed(
  VerifySlots,
  VerifySlots.of({ running: Effect.die("unused") }),
);

export const UnusedTerminals = Layer.succeed(
  Terminals,
  Terminals.of({
    open: () => Stream.die("unused"),
    write: () => Effect.die("unused"),
    resize: () => Effect.die("unused"),
    kill: () => Effect.die("unused"),
    isRunning: () => Effect.die("unused"),
  }),
);

export const UnusedPullRequests = Layer.succeed(
  PullRequests,
  PullRequests.of({
    available: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
    walkThrough: () => Effect.die("unused"),
    walkThroughStack: () => Effect.die("unused"),
    review: () => Effect.die("unused"),
    postReview: () => Effect.die("unused"),
    tryIt: () => Effect.die("unused"),
    dismiss: () => Effect.die("unused"),
    worktree: () => Effect.die("unused"),
  }),
);

export const UnusedTools = Layer.succeed(
  Tools,
  Tools.of({ check: Effect.die("unused") }),
);

export const UnusedWorktreeCleanup = Layer.succeed(
  WorktreeCleanup,
  WorktreeCleanup.of({ archive: () => Effect.die("unused") }),
);

export const UnusedFlows = Layer.succeed(
  Flows,
  Flows.of({
    flow: () => Stream.die("unused"),
    checkpoints: Stream.die("unused"),
    phases: Stream.die("unused"),
    isOver: () => Effect.die("unused"),
    approve: () => Effect.die("unused"),
    decline: () => Effect.die("unused"),
    send: () => Effect.die("unused"),
    skip: () => Effect.die("unused"),
    findingVerdict: () => Effect.die("unused"),
  }),
);

export const UnusedRounds = Layer.succeed(
  Rounds,
  Rounds.of({
    post: () => Effect.die("unused"),
    answer: () => Effect.die("unused"),
    list: () => Stream.die("unused"),
  }),
);

// The issue tracker, faked: the Brief #2 and its tickets #3 and #4 exist, nothing else does. The
// tickets are closed, as Implement leaves them.
const issue = (
  number: number,
  title: string,
  state: TrackedIssue["state"],
): TrackedIssue => ({
  number,
  title,
  url: `https://github.com/acme/app/issues/${number}`,
  state,
});
const ISSUES = new Map([
  [2, issue(2, "Dark mode", "open")],
  [3, issue(3, "Add the theme setting", "closed")],
  [4, issue(4, "Toggle in the settings page", "closed")],
]);
export const FakeIssues = Layer.succeed(
  IssueTracker,
  IssueTracker.of({
    issue: (_cwd, number) =>
      Effect.succeed(Option.fromNullishOr(ISSUES.get(number))),
  }),
);

export const unusedAutonomy = Autonomy.of({
  covers: () => Effect.die("unused"),
  approved: () => Effect.die("unused"),
  declined: () => Effect.die("unused"),
  approvedByFern: () => Effect.die("unused"),
  withdraw: () => Effect.die("unused"),
  redirected: () => Effect.die("unused"),
  autonomy: () => Stream.die("unused"),
  accept: () => Effect.die("unused"),
  decline: () => Effect.die("unused"),
});

export const UnusedAutonomy = Layer.succeed(Autonomy, unusedAutonomy);

// Autonomy for Sessions outside the Flow: no Redirect is ever an Escape.
export const NoEscapes = Layer.succeed(
  Autonomy,
  Autonomy.of({ ...unusedAutonomy, redirected: () => Effect.void }),
);
