import { getSessionInfo, tool } from "@anthropic-ai/claude-agent-sdk";
import {
  FlowPhase,
  NothingToReview,
  SessionNotFound,
  StackPrKind,
  WalkthroughError,
  type WalkthroughInProgress,
} from "@repo/api";
import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { z } from "zod";
import { sdk } from "../agentSdk";
import { CodeHost, MergeRefused } from "../codehost/CodeHost";
import { Git, type GitError } from "../git/Git";
import { IssueTracker, IssueTrackerTimeout } from "../issue/IssueTracker";
import { FernTools } from "../turn/FernTools";
import { HostedSessions } from "../turn/HostedSessions";
import { Turns } from "../turn/Turns";
import { Walkthroughs } from "../walkthrough/Walkthroughs";
import { Worktrees } from "../worktree/Worktrees";
import { StackEligibility } from "./StackEligibility";

// One draft PR on a Session's Stack, as Fern records it.
export const StackPr = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  // 1 for the bottom PR, based on `main`.
  position: Schema.Int,
  kind: StackPrKind,
  // The ticket whose work it carries; none for a fix or the Findings.
  ticket: Schema.NullOr(Schema.Int),
  title: Schema.String,
  // The commit on the Session's branch the PR's branch points at: where its ticket merged, or
  // the fix or Findings commit.
  mergeCommit: Schema.String,
  // The PR's head branch on `origin`, and the branch it's based on: the PR below's, or `main`.
  branch: Schema.String,
  base: Schema.String,
  number: Schema.Int,
  url: Schema.String,
  createdAt: Schema.Finite,
});
export type StackPr = typeof StackPr.Type;

// What the agent reports landed on the Session's branch, to go up as the top PR of the Stack: a
// ticket's merge, a fix for Rejections, or the commit with the accepted Findings.
export type Landed = { readonly commit: string } & (
  | { readonly kind: "ticket"; readonly ticket: number }
  | { readonly kind: "fix"; readonly title: string }
  | { readonly kind: "findings" }
);

// What a Fern tool answers the agent.
export interface Answer {
  readonly text: string;
  readonly isError: boolean;
}
export const reply = ({ text, isError }: Answer) => ({
  content: [{ type: "text" as const, text }],
  ...(isError ? { isError } : {}),
});
const refused = (text: string): Answer => ({ text, isError: true });

// The branch every Stack is based on.
const TRUNK = "main";
// GitHub's own limit on a PR's title.
const MAX_TITLE = 256;
// What the Findings PR is called.
const FINDINGS_TITLE = "Setup changes from the Retro";

// The commit the agent reports, as a Fern tool takes it.
export const commitArg = (what: string) =>
  z
    .string()
    .regex(/^[0-9a-f]{7,64}$/i)
    .describe(`The full hash of ${what} on this Session's branch`);

export const STEERING = `This Session's work lands as a GitHub Stack: one draft PR per ticket, in the order the tickets merge into this Session's branch, each based on the one below. Each time a ticket merges into this Session's branch, call Fern's \`ticket_landed\` tool with the ticket's issue number and the merge commit's full hash on this Session's branch. Fern pushes a branch at that commit, opens the ticket's draft PR on top of the Stack, and writes its Walkthrough while you carry on with the next ticket. This replaces pushing to \`main\`: never push to \`main\` or open PRs yourself, whatever the repo's docs say. Implement is done once every one of those tickets has its PR in the Stack: tickets close when the Stack lands, so don't wait for them to. When the developer's Rejections of a PR's Walkthrough reach you, commit the fix on this Session's branch, then call \`fix_landed\` with that commit and a title for the fix: it goes up as a new PR on top of the Stack, so never change the PRs below.`;

// Where a Session without tickets lands as a Stack of one PR, which Fern keeps up to date itself.
export const ONE_PR_STEERING = `When this Session has no tickets, because the developer skipped Spec, its work lands as one draft PR on GitHub instead, which Fern keeps up to date itself: don't report anything with \`ticket_landed\` or \`fix_landed\`. Commit your work on this Session's branch as you go: after each of your turns, Fern pushes the branch to the PR and writes a Walkthrough of what was committed since the previous one. Changes you leave uncommitted are in neither, so Implement isn't done, and the PR can't land, while there are any. Never push to \`main\` or open PRs yourself, whatever the repo's docs say. When the developer's Rejections reach you, commit the fix on this Session's branch: Fern's next Walkthrough shows it.`;

const TICKET_LANDED = `Report that a ticket merged into this Session's branch. Fern pushes a branch at the merge commit and opens the ticket's draft PR on top of the Session's Stack, then writes its Walkthrough in the background. Report tickets in the order they merged.`;

const FIX_LANDED = `Report a fix for the developer's Rejections, committed on this Session's branch. Fern pushes a branch at the commit and opens its draft PR on top of the Session's Stack, then writes its Walkthrough in the background, linked to the Rejections it fixes.`;

const PRS_UPDATED = `After GitHub refused to land this Session's Stack and Fern sent you why, report the new head commit of each PR you changed to fix it, bottom first. Fern moves each PR's branch on GitHub to its new head. Each new head must be on this Session's branch and build on the head of the PR below.`;

// The most PRs one report may name.
const MAX_STACK = 100;

// The placeholder description a PR opens with, until its Walkthrough becomes the description.
const openingBody = (report: Landed) =>
  [
    "Fern is writing this PR's Walkthrough.",
    ...(report.kind === "ticket" ? [`Closes #${report.ticket}`] : []),
  ].join("\n\n");

// What a Session's one PR is called: the Session's title, as the sidebar shows it, without the
// skill its first message starts (`/grill-with-docs`).
const sessionTitle = (sessionId: string, branch: string) =>
  sdk("getSessionInfo", () => getSessionInfo(sessionId)).pipe(
    Effect.map(
      (info) =>
        (info?.customTitle ?? info?.summary ?? "")
          .trim()
          .replace(/^\/\S+\s+/u, "") || `Session on ${branch}`,
    ),
    Effect.orElseSucceed(() => `Session on ${branch}`),
    Effect.map((title) => title.slice(0, MAX_TITLE)),
  );

// What the report is, as the agent hears it.
const named = (report: Landed) =>
  report.kind === "ticket"
    ? `Ticket #${report.ticket}`
    : report.kind === "fix"
      ? "The fix"
      : "The Findings commit";

// What the PR is called, as Fern names it.
const prName = (pr: StackPr) =>
  pr.kind === "ticket" ? `ticket #${pr.ticket ?? "?"}` : `"${pr.title}"`;

// A Hosted Session's Stack on GitHub (ADR 0009): the agent reports each ticket as it lands on the
// Session's branch, and each fix and the accepted Findings after it, and Fern opens its draft PR on
// top of the Stack and has its Walkthrough written.
export class Stacks extends Context.Service<
  Stacks,
  {
    // The Session's PRs, bottom first.
    prs(sessionId: string): Effect.Effect<ReadonlyArray<StackPr>>;
    // Whether the Session's work lands as a Stack: it has PRs up already, or would put them up.
    // A Stack that's started stays one, even once its Project opts out or gh signs out.
    landsAsStack(sessionId: string): Effect.Effect<boolean>;
    // Whether the Session's Stack is one PR carrying all its work, as for a Session whose Spec was
    // skipped: it has that PR up already, or would put it up. Never for a Session whose Spec wrote
    // tickets, nor for one still before Spec.
    landsAsOnePr(sessionId: string): Effect.Effect<boolean>;
    // Writes a Walkthrough of what changed since the Session's last one. On a Session's one PR, it's
    // what was committed on the Session's branch: Fern pushes the branch to the PR, opening the PR
    // with its first Walkthrough. Elsewhere, a snapshot of the working tree.
    write(
      sessionId: string,
    ): Effect.Effect<
      void,
      | SessionNotFound
      | NothingToReview
      | WalkthroughInProgress
      | WalkthroughError
    >;
    // What the Session's one PR waits on before it can Land, besides its Walkthroughs: the agent
    // working, uncommitted changes, or commits no Walkthrough covers yet. Nothing for any other
    // Stack.
    onePrWaits(sessionId: string): Effect.Effect<ReadonlyArray<string>>;
    // Puts what landed at the commit up as the top PR of the Session's Stack. What to answer the
    // agent, never a failure.
    landed(sessionId: string, report: Landed): Effect.Effect<Answer>;
    // Marks the Session's PRs ready and squash-merges its Stack into `main`, all at once. Fails
    // with GitHub's reason when it refuses, or when Fern can't reach it.
    land(sessionId: string): Effect.Effect<void, MergeRefused>;
    // Whether the Session's Stack has merged into `main`, as GitHub says; never for a Session
    // without one, or when GitHub can't say.
    merged(sessionId: string): Effect.Effect<boolean>;
  }
>()("@repo/server/stack/Stacks") {
  static readonly layer = Layer.effect(
    Stacks,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const eligibility = yield* StackEligibility;
      const hosted = yield* HostedSessions;
      const codeHost = yield* CodeHost;
      const issues = yield* IssueTracker;
      const walkthroughs = yield* Walkthroughs;
      const git = yield* Git;
      const tools = yield* FernTools;
      const turns = yield* Turns;
      const worktrees = yield* Worktrees;
      const patience = Duration.fromInputUnsafe(yield* IssueTrackerTimeout);
      // One report at a time, so each PR's base is the one opened before it.
      const reporting = yield* Semaphore.make(1);

      const prsOf = SqlSchema.findAll({
        Request: Schema.String,
        Result: StackPr,
        execute: (sessionId) =>
          sql`SELECT * FROM stack_prs WHERE session_id = ${sessionId} ORDER BY position`,
      });
      const prs = (sessionId: string) => prsOf(sessionId).pipe(Effect.orDie);

      const commitOf = (repo: string, rev: string) =>
        git
          .run(repo, ["rev-parse", "--verify", "-q", `${rev}^{commit}`])
          .pipe(Effect.map((out) => out.trim()));
      const isAncestor = (repo: string, ancestor: string, of: string) =>
        git.run(repo, ["merge-base", "--is-ancestor", ancestor, of]).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
      // Where the bottom PR leaves `main`; where the Session's branch started, without a `main`.
      const forkPoint = (repo: string, commit: string, base: string) =>
        git.run(repo, ["merge-base", `refs/heads/${TRUNK}`, commit]).pipe(
          Effect.map((out) => out.trim()),
          Effect.orElseSucceed(() => base),
        );

      // The ticket's title on the issue tracker, to title its PR; its number when the tracker
      // can't say.
      const ticketTitle = (cwd: string, ticket: number) =>
        issues.issue(cwd, ticket).pipe(
          Effect.timeout(patience),
          Effect.map(
            Option.match({
              onNone: () => `Ticket #${ticket}`,
              onSome: (issue) => issue.title,
            }),
          ),
          Effect.orElseSucceed(() => `Ticket #${ticket}`),
        );
      const titleOf = (cwd: string, report: Landed) =>
        (report.kind === "ticket"
          ? ticketTitle(cwd, report.ticket)
          : Effect.succeed(
              report.kind === "fix" ? report.title.trim() : FINDINGS_TITLE,
            )
        ).pipe(Effect.map((title) => title.slice(0, MAX_TITLE)));

      // The PR's head branch, named for what it carries.
      const branchOf = (
        session: string,
        report: Landed,
        stack: ReadonlyArray<StackPr>,
      ) =>
        `fern/${session}/${
          report.kind === "ticket"
            ? `t${report.ticket}`
            : report.kind === "fix"
              ? `fix${stack.filter((pr) => pr.kind === "fix").length + 1}`
              : "findings"
        }`;

      // The PR already up for what was reported, if there is one.
      const alreadyUp = (stack: ReadonlyArray<StackPr>, report: Landed) =>
        stack.find(
          (pr) =>
            (report.kind === "fix" && pr.mergeCommit === report.commit) ||
            (report.kind === "ticket" && pr.ticket === report.ticket) ||
            (report.kind === "findings" && pr.kind === "findings"),
        );

      const worktreeOf = (sessionId: string) =>
        hosted.worktrees.pipe(
          Effect.map((all) => all.find((w) => w.id === sessionId)),
        );

      // Whether the Session has no tickets: Spec is behind it, skipped or done, and wrote none.
      const phasesOf = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: Schema.Struct({
          phases: Schema.fromJsonString(Schema.Array(FlowPhase)),
        }),
        execute: (sessionId) =>
          sql`SELECT phases FROM flows WHERE session_id = ${sessionId}`,
      });
      const specWithTickets = SqlSchema.findAll({
        Request: Schema.String,
        Result: Schema.Struct({ id: Schema.String }),
        execute: (sessionId) => sql`
          SELECT id FROM checkpoints
          WHERE session_id = ${sessionId} AND phase = 'spec' AND status = 'approved'
            AND spec IS NOT NULL
          LIMIT 1`,
      });
      const ticketless = (sessionId: string) =>
        Effect.gen(function* () {
          const flow = yield* phasesOf(sessionId);
          const spec = Option.getOrUndefined(flow)?.phases.find(
            (p) => p.phase === "spec",
          )?.status;
          if (spec !== "done" && spec !== "skipped") return false;
          return (yield* specWithTickets(sessionId)).length === 0;
        }).pipe(Effect.orDie);

      const landsAsOnePr = (sessionId: string) =>
        prs(sessionId).pipe(
          Effect.flatMap((up) =>
            up.length > 0
              ? Effect.succeed(up.some((pr) => pr.kind === "session"))
              : ticketless(sessionId).pipe(
                  Effect.flatMap((none) =>
                    none
                      ? eligibility.applies(sessionId)
                      : Effect.succeed(false),
                  ),
                ),
          ),
        );

      // Puts what was committed on the Session's branch since its one PR's last Walkthrough up in
      // the PR, opening the PR the first time, and writes a Walkthrough of it. The Walkthrough is
      // stored before the PR's head moves, so the PR never looks covered while it isn't.
      const writeOne = Effect.fn("Stacks.writeOne")(
        function* (sessionId: string) {
          if (!(yield* eligibility.applies(sessionId)))
            return yield* new WalkthroughError({
              message:
                "Fern can't update this Session's PR right now: its Project opted out of Stacks, or `gh` isn't ready.",
            });
          const session = yield* worktreeOf(sessionId);
          if (!session) return yield* new SessionNotFound({ id: sessionId });
          const repo = session.worktree;
          const pr = (yield* prs(sessionId)).find((p) => p.kind === "session");
          const tip = yield* commitOf(repo, `refs/heads/${session.branch}`);
          const from =
            pr?.mergeCommit ??
            (yield* forkPoint(repo, tip, session.baseCommit));
          const [fromTree, tipTree] = yield* Effect.all([
            git.run(repo, ["rev-parse", `${from}^{tree}`]),
            git.run(repo, ["rev-parse", `${tip}^{tree}`]),
          ]);
          if (fromTree.trim() === tipTree.trim())
            return yield* new NothingToReview({ sessionId });
          if (pr) {
            yield* walkthroughs.writePr(sessionId, {
              id: pr.id,
              cwd: session.cwd,
              from,
              to: tip,
              since: "previous",
            });
            yield* codeHost.push(session.cwd, {
              commit: tip,
              branch: pr.branch,
              replacing: pr.mergeCommit,
            });
            return yield* sql`UPDATE stack_prs SET merge_commit = ${tip} WHERE id = ${pr.id}`.pipe(
              Effect.orDie,
            );
          }
          const branch = `fern/${session.branch}/session`;
          const title = yield* sessionTitle(sessionId, session.branch);
          yield* codeHost.push(session.cwd, { commit: tip, branch });
          const opened = yield* codeHost.openDraft(session.cwd, {
            head: branch,
            base: TRUNK,
            title,
            body: "Fern is writing this PR's Walkthrough.",
          });
          const pr1: StackPr = {
            id: crypto.randomUUID(),
            sessionId,
            position: 1,
            kind: "session",
            ticket: null,
            title,
            mergeCommit: tip,
            branch,
            base: TRUNK,
            number: opened.number,
            url: opened.url,
            createdAt: yield* Clock.currentTimeMillis,
          };
          yield* sql`INSERT INTO stack_prs ${sql.insert(pr1)}`.pipe(
            Effect.orDie,
          );
          return yield* walkthroughs.writePr(sessionId, {
            id: pr1.id,
            cwd: session.cwd,
            from,
            to: tip,
            since: "start",
          });
        },
        Effect.catchTags({
          CodeHostError: (error) =>
            Effect.fail(
              new WalkthroughError({
                message: `Fern couldn't push the Session's PR to GitHub (${error.message})`,
              }),
            ),
          GitError: (error: GitError) =>
            Effect.fail(new WalkthroughError({ message: error.message })),
        }),
      );

      const write = (sessionId: string) =>
        landsAsOnePr(sessionId).pipe(
          Effect.flatMap((one) =>
            one
              ? reporting.withPermits(1)(writeOne(sessionId))
              : walkthroughs.write(sessionId),
          ),
        );

      const onePrWaits = Effect.fn("Stacks.onePrWaits")(
        function* (sessionId: string) {
          const pr = (yield* prs(sessionId)).find((p) => p.kind === "session");
          const session = yield* worktreeOf(sessionId);
          if (!pr || !session) return [];
          const [running, dirty, tipTree, prTree] = yield* Effect.all([
            turns.running.pipe(Effect.map((ids) => ids.includes(sessionId))),
            worktrees.isDirty(session.worktree),
            git.run(session.worktree, [
              "rev-parse",
              `refs/heads/${session.branch}^{tree}`,
            ]),
            git.run(session.worktree, ["rev-parse", `${pr.mergeCommit}^{tree}`]),
          ]);
          return [
            ...(running ? ["The agent is still working on the Session."] : []),
            ...(dirty
              ? [
                  "The Session's worktree has changes that aren't committed, and its PR carries only what's committed. Commit them on the Session's branch, or throw them away.",
                ]
              : []),
            ...(tipTree.trim() === prTree.trim()
              ? []
              : [
                  "What's been committed on the Session's branch since its last Walkthrough has no Walkthrough yet.",
                ]),
          ];
        },
        Effect.catch((error) =>
          Effect.succeed([
            `Fern couldn't read the Session's worktree (${error.message}).`,
          ]),
        ),
      );

      const put = Effect.fn("Stacks.landed")(function* (
        sessionId: string,
        report: Landed,
      ) {
        const stack = yield* prs(sessionId);
        if (!(yield* eligibility.applies(sessionId)))
          return refused(
            stack.length > 0
              ? "Fern can't put anything on this Session's Stack right now: its Project opted out of Stacks, or `gh` isn't ready. Report it again once that's fixed."
              : "This Session's work doesn't land as a Stack: its Project is off GitHub, opted out of Stacks, or `gh` isn't ready. Land it as the repo's docs say.",
          );
        if (yield* landsAsOnePr(sessionId))
          return refused(
            "This Session has no tickets, so its work goes up as one PR, which Fern pushes after each of your turns: commit on this Session's branch, and there's nothing to report.",
          );
        const session = (yield* hosted.worktrees).find(
          (w) => w.id === sessionId,
        );
        if (!session)
          return refused("Fern doesn't know this Session's worktree.");
        const repo = session.worktree;
        const reported = report.commit;
        const found = yield* commitOf(repo, reported).pipe(Effect.option);
        if (Option.isNone(found))
          return refused(
            `${reported} isn't a commit in this repository. Report the commit's full hash.`,
          );
        const commit = found.value;
        if (!(yield* isAncestor(repo, commit, `refs/heads/${session.branch}`)))
          return refused(
            `${reported} isn't on this Session's branch, ${session.branch}. ${report.kind === "ticket" ? "Merge the ticket into it, then report the merge commit." : "Commit it there, then report that commit."}`,
          );

        const already = alreadyUp(stack, { ...report, commit });
        if (already)
          return {
            text: `${named(report)} is already up as PR #${already.number} (${already.url}).`,
            isError: false,
          };
        const below = stack.at(-1);
        if (report.kind !== "ticket" && below === undefined)
          return refused(
            `The Stack has no PRs yet, so there's nothing for ${named(report).toLowerCase()} to go on top of. Report each ticket with \`ticket_landed\` first.`,
          );
        if (below && !(yield* isAncestor(repo, below.mergeCommit, commit)))
          return refused(
            `${reported} doesn't build on PR #${below.number} (${prName(below)}), the top of the Stack. Report what lands on this Session's branch in the order it lands.`,
          );
        const from = below
          ? below.mergeCommit
          : yield* forkPoint(repo, commit, session.baseCommit);
        const [fromTree, toTree] = yield* Effect.all([
          git.run(repo, ["rev-parse", `${from}^{tree}`]),
          git.run(repo, ["rev-parse", `${commit}^{tree}`]),
        ]);
        if (fromTree.trim() === toTree.trim())
          return refused(
            `${reported} changes nothing since ${below ? `PR #${below.number}` : TRUNK}, so there's no PR to open.`,
          );

        const title = yield* titleOf(session.cwd, report);
        const branch = branchOf(session.branch, report, stack);
        const base = below?.branch ?? TRUNK;
        yield* codeHost.push(session.cwd, { commit, branch });
        const opened = yield* codeHost.openDraft(session.cwd, {
          head: branch,
          base,
          title,
          body: openingBody(report),
        });
        const pr: StackPr = {
          id: crypto.randomUUID(),
          sessionId,
          position: stack.length + 1,
          kind: report.kind,
          ticket: report.kind === "ticket" ? report.ticket : null,
          title,
          mergeCommit: commit,
          branch,
          base,
          number: opened.number,
          url: opened.url,
          createdAt: yield* Clock.currentTimeMillis,
        };
        yield* sql`INSERT INTO stack_prs ${sql.insert(pr)}`.pipe(Effect.orDie);
        // One PR is no Stack yet. The PR stands on its base either way, and linking again with the
        // next PR catches up.
        if (stack.length > 0)
          yield* codeHost
            .link(session.cwd, [...stack, pr])
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning("Couldn't link the Stack", error.message),
              ),
            );
        const written = yield* walkthroughs
          .writePr(sessionId, { id: pr.id, cwd: session.cwd, from, to: commit })
          .pipe(
            Effect.as(" Fern is writing its Walkthrough."),
            Effect.catch((error) =>
              Effect.succeed(
                ` Fern couldn't start its Walkthrough (${error._tag === "WalkthroughError" ? error.message : "nothing changed"}).`,
              ),
            ),
          );
        return {
          text: `${named(report)} is up as draft PR #${opened.number} (${opened.url}), based on ${base}.${written}${report.kind === "ticket" ? " Carry on with the next ticket." : ""}`,
          isError: false,
        };
      });

      const landed = (sessionId: string, report: Landed) =>
        reporting
          .withPermits(1)(put(sessionId, report))
          .pipe(
            Effect.catchTags({
              CodeHostError: (error) =>
                Effect.succeed(
                  refused(
                    `Fern couldn't put ${named(report).toLowerCase()} up on GitHub (${error.message}). Report it again once that's fixed.`,
                  ),
                ),
              GitError: (error: GitError) =>
                Effect.succeed(
                  refused(
                    `Fern couldn't read the commit (${error.message}). Report it again.`,
                  ),
                ),
            }),
          );

      const land = Effect.fn("Stacks.land")(
        function* (sessionId: string) {
          const stack = yield* prs(sessionId);
          const session = yield* worktreeOf(sessionId);
          if (!session || stack.length === 0)
            return yield* new MergeRefused({
              reason: "This Session has no Stack to land.",
            });
          // Merged already: outside Fern, or by an earlier try GitHub finished late.
          if ((yield* codeHost.state(session.cwd, stack)).merged)
            return yield* Effect.void;
          yield* codeHost.markReady(session.cwd, stack);
          return yield* codeHost.merge(session.cwd, stack);
        },
        Effect.catchTag("CodeHostError", (error) =>
          Effect.fail(
            new MergeRefused({
              reason: `Fern couldn't reach GitHub (${error.message}).`,
            }),
          ),
        ),
      );

      const merged = Effect.fn("Stacks.merged")(function* (sessionId: string) {
        const stack = yield* prs(sessionId);
        const session = yield* worktreeOf(sessionId);
        if (!session || stack.length === 0) return false;
        return yield* codeHost.state(session.cwd, stack).pipe(
          Effect.map((state) => state.merged),
          Effect.catch((error) =>
            Effect.logWarning(
              "Couldn't read the Stack's state",
              error.message,
            ).pipe(Effect.as(false)),
          ),
        );
      });

      // After a refused Land, the agent reports the new heads of the PRs it changed, bottom first:
      // Fern moves each PR's branch to its new head, as long as every PR still builds on the one
      // below and only the branches Fern last pushed are moved.
      const repush = Effect.fn("Stacks.repush")(function* (
        sessionId: string,
        heads: ReadonlyArray<{ readonly pr: number; readonly commit: string }>,
      ) {
        const stack = yield* prs(sessionId);
        const session = yield* worktreeOf(sessionId);
        if (!session || stack.length === 0)
          return refused("This Session has no Stack to update.");
        const repo = session.worktree;
        const moved = new Map<number, string>();
        for (const head of heads) {
          if (!stack.some((pr) => pr.number === head.pr))
            return refused(
              `PR #${head.pr} isn't on this Session's Stack: ${stack.map((pr) => `#${pr.number}`).join(", ")}.`,
            );
          if (moved.has(head.pr))
            return refused(`PR #${head.pr} is reported twice.`);
          const found = yield* commitOf(repo, head.commit).pipe(Effect.option);
          if (Option.isNone(found))
            return refused(
              `${head.commit} isn't a commit in this repository. Report each commit's full hash.`,
            );
          if (
            !(yield* isAncestor(
              repo,
              found.value,
              `refs/heads/${session.branch}`,
            ))
          )
            return refused(
              `${head.commit} isn't on this Session's branch, ${session.branch}. Merge PR #${head.pr}'s new head into it, then report again.`,
            );
          moved.set(head.pr, found.value);
        }
        const after = stack.map((pr) => ({
          ...pr,
          mergeCommit: moved.get(pr.number) ?? pr.mergeCommit,
        }));
        for (const [i, pr] of after.entries()) {
          const below = after[i - 1];
          if (below && !(yield* isAncestor(repo, below.mergeCommit, pr.mergeCommit)))
            return refused(
              `PR #${pr.number}'s head doesn't build on PR #${below.number}'s ${moved.has(below.number) ? "new " : ""}head, so the Stack would break. Merge PR #${below.number}'s head into it, then report PR #${pr.number}'s new head too.`,
            );
        }
        const changed = stack.filter(
          (pr) => (moved.get(pr.number) ?? pr.mergeCommit) !== pr.mergeCommit,
        );
        for (const pr of changed) {
          const commit = moved.get(pr.number) ?? pr.mergeCommit;
          yield* codeHost.push(session.cwd, {
            commit,
            branch: pr.branch,
            replacing: pr.mergeCommit,
          });
          yield* sql`UPDATE stack_prs SET merge_commit = ${commit} WHERE id = ${pr.id}`.pipe(
            Effect.orDie,
          );
        }
        return {
          text:
            changed.length === 0
              ? "Nothing changed: every PR already points at those commits."
              : `Fern pushed ${changed.map((pr) => `PR #${pr.number}`).join(", ")} to ${changed.length === 1 ? "its new head" : "their new heads"}. The developer tries landing the Stack again once you end your turn.`,
          isError: false,
        };
      });

      const prsUpdated = (
        sessionId: string,
        heads: ReadonlyArray<{ readonly pr: number; readonly commit: string }>,
      ) =>
        reporting
          .withPermits(1)(repush(sessionId, heads))
          .pipe(
            Effect.catchTag("CodeHostError", (error) =>
              Effect.succeed(
                refused(
                  `Fern couldn't push to GitHub (${error.message}). Report the heads again once that's fixed.`,
                ),
              ),
            ),
          );

      const landsAsStack = (sessionId: string) =>
        prs(sessionId).pipe(
          Effect.flatMap((up) =>
            up.length > 0
              ? Effect.succeed(true)
              : eligibility.applies(sessionId),
          ),
        );

      const run = Effect.runPromiseWith(yield* Effect.context());
      // Each turn a Session without tickets finishes, its one PR catches up with its branch.
      yield* turns.finished.pipe(
        Stream.runForEach(({ id }) =>
          Effect.when(write(id), landsAsOnePr(id)).pipe(
            Effect.catchTags({
              NothingToReview: () => Effect.void,
              WalkthroughInProgress: () => Effect.void,
            }),
            Effect.catch((error) =>
              Effect.logWarning(
                "Couldn't write the Walkthrough of the Session's PR",
                error._tag === "SessionNotFound" ? error._tag : error.message,
              ),
            ),
          ),
        ),
        Effect.forkScoped,
      );

      // A Stack of tickets: up already, or to come, but not a Session's one PR. A Session's steering
      // is set as its Claude Code process opens, usually before Spec says whether it has tickets,
      // so until then it's told about both.
      const ticketed = (sessionId: string) =>
        Effect.all([landsAsStack(sessionId), landsAsOnePr(sessionId)]).pipe(
          Effect.map(([stack, one]) => stack && !one),
        );
      const mayBeOnePr = (sessionId: string) =>
        Effect.gen(function* () {
          if (!(yield* landsAsStack(sessionId))) return false;
          const up = yield* prs(sessionId);
          if (up.length > 0) return up.some((pr) => pr.kind === "session");
          return (
            (yield* specWithTickets(sessionId).pipe(Effect.orDie)).length === 0
          );
        });
      yield* tools.register({
        steering: ONE_PR_STEERING,
        when: mayBeOnePr,
        tools: () => [],
      });
      yield* tools.register({
        steering: STEERING,
        when: ticketed,
        tools: () => [],
      });
      yield* tools.register({
        when: (sessionId) => landsAsStack(sessionId),
        tools: (sessionId) => [
          tool(
            "ticket_landed",
            TICKET_LANDED,
            {
              ticket: z
                .number()
                .int()
                .positive()
                .describe("The ticket's issue number"),
              commit: commitArg("the ticket's merge commit"),
            },
            ({ ticket, commit }) =>
              run(
                landed(sessionId, { kind: "ticket", ticket, commit }).pipe(
                  Effect.map(reply),
                ),
              ),
          ),
          tool(
            "fix_landed",
            FIX_LANDED,
            {
              commit: commitArg("the commit with the fix"),
              title: z
                .string()
                .trim()
                .min(1)
                .max(MAX_TITLE)
                .describe("What the fix changes, in a line: the PR's title"),
            },
            ({ commit, title }) =>
              run(
                landed(sessionId, { kind: "fix", title, commit }).pipe(
                  Effect.map(reply),
                ),
              ),
          ),
          tool(
            "prs_updated",
            PRS_UPDATED,
            {
              prs: z
                .array(
                  z.object({
                    pr: z.number().int().positive().describe("The PR's number"),
                    commit: commitArg("the PR's new head"),
                  }),
                )
                .min(1)
                .max(MAX_STACK)
                .describe("Each PR you changed, bottom first"),
            },
            ({ prs: heads }) =>
              run(prsUpdated(sessionId, heads).pipe(Effect.map(reply))),
          ),
        ],
      });

      return Stacks.of({
        prs,
        landsAsStack,
        landsAsOnePr,
        write,
        onePrWaits,
        landed,
        land,
        merged,
      });
    }),
  ).pipe(Layer.provide(Git.layer));
}
