import { tool } from "@anthropic-ai/claude-agent-sdk";
import { StackPrKind } from "@repo/api";
import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
  Semaphore,
} from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { z } from "zod";
import { CodeHost } from "../codehost/CodeHost";
import { Git, type GitError } from "../git/Git";
import { IssueTracker, IssueTrackerTimeout } from "../issue/IssueTracker";
import { FernTools } from "../turn/FernTools";
import { HostedSessions } from "../turn/HostedSessions";
import { Walkthroughs } from "../walkthrough/Walkthroughs";
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

const TICKET_LANDED = `Report that a ticket merged into this Session's branch. Fern pushes a branch at the merge commit and opens the ticket's draft PR on top of the Session's Stack, then writes its Walkthrough in the background. Report tickets in the order they merged.`;

const FIX_LANDED = `Report a fix for the developer's Rejections, committed on this Session's branch. Fern pushes a branch at the commit and opens its draft PR on top of the Session's Stack, then writes its Walkthrough in the background, linked to the Rejections it fixes.`;

// The placeholder description a PR opens with, until its Walkthrough becomes the description.
const openingBody = (report: Landed) =>
  [
    "Fern is writing this PR's Walkthrough.",
    ...(report.kind === "ticket" ? [`Closes #${report.ticket}`] : []),
  ].join("\n\n");

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
    // Puts what landed at the commit up as the top PR of the Session's Stack. What to answer the
    // agent, never a failure.
    landed(sessionId: string, report: Landed): Effect.Effect<Answer>;
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

      const landsAsStack = (sessionId: string) =>
        prs(sessionId).pipe(
          Effect.flatMap((up) =>
            up.length > 0
              ? Effect.succeed(true)
              : eligibility.applies(sessionId),
          ),
        );

      const run = Effect.runPromiseWith(yield* Effect.context());
      yield* tools.register({
        steering: STEERING,
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
        ],
      });

      return Stacks.of({ prs, landsAsStack, landed });
    }),
  ).pipe(Layer.provide(Git.layer));
}
