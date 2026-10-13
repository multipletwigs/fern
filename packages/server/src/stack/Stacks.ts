import { tool } from "@anthropic-ai/claude-agent-sdk";
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
  ticket: Schema.NullOr(Schema.Int),
  title: Schema.String,
  // The ticket's merge commit on the Session's branch, which the PR's branch points at.
  mergeCommit: Schema.String,
  // The PR's head branch on `origin`, and the branch it's based on: the PR below's, or `main`.
  branch: Schema.String,
  base: Schema.String,
  number: Schema.Int,
  url: Schema.String,
  createdAt: Schema.Finite,
});
export type StackPr = typeof StackPr.Type;

// What a Fern tool answers the agent.
export interface Answer {
  readonly text: string;
  readonly isError: boolean;
}
const reply = ({ text, isError }: Answer) => ({
  content: [{ type: "text" as const, text }],
  ...(isError ? { isError } : {}),
});
const refused = (text: string): Answer => ({ text, isError: true });

// The branch every Stack is based on.
const TRUNK = "main";
// GitHub's own limit on a PR's title.
const MAX_TITLE = 256;

export const STEERING = `This Session's work lands as a GitHub Stack: one draft PR per ticket, in the order the tickets merge into this Session's branch, each based on the one below. Each time a ticket merges into this Session's branch, call Fern's \`ticket_landed\` tool with the ticket's issue number and the merge commit's full hash on this Session's branch. Fern pushes a branch at that commit, opens the ticket's draft PR on top of the Stack, and writes its Walkthrough while you carry on with the next ticket. This replaces pushing to \`main\`: never push to \`main\` or open PRs yourself, whatever the repo's docs say.`;

const TICKET_LANDED = `Report that a ticket merged into this Session's branch. Fern pushes a branch at the merge commit and opens the ticket's draft PR on top of the Session's Stack, then writes its Walkthrough in the background. Report tickets in the order they merged.`;

// The placeholder description a PR opens with, until its Walkthrough becomes the description.
const openingBody = (ticket: number) =>
  `Fern is writing this PR's Walkthrough.\n\nCloses #${ticket}`;

// A Hosted Session's Stack on GitHub (ADR 0009): the agent reports each ticket as it lands on the
// Session's branch, and Fern opens the ticket's draft PR on top of the Stack and has its
// Walkthrough written.
export class Stacks extends Context.Service<
  Stacks,
  {
    // The Session's PRs, bottom first.
    prs(sessionId: string): Effect.Effect<ReadonlyArray<StackPr>>;
    // Puts the ticket that merged at the commit up as the top PR of the Session's Stack. What to
    // answer the agent, never a failure.
    landed(
      sessionId: string,
      report: { readonly ticket: number; readonly commit: string },
    ): Effect.Effect<Answer>;
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
      const titleOf = (cwd: string, ticket: number) =>
        issues.issue(cwd, ticket).pipe(
          Effect.timeout(patience),
          Effect.map(
            Option.match({
              onNone: () => `Ticket #${ticket}`,
              onSome: (issue) => issue.title,
            }),
          ),
          Effect.orElseSucceed(() => `Ticket #${ticket}`),
          Effect.map((title) => title.slice(0, MAX_TITLE)),
        );

      const put = Effect.fn("Stacks.landed")(function* (
        sessionId: string,
        {
          ticket,
          commit: reported,
        }: { readonly ticket: number; readonly commit: string },
      ) {
        if (!(yield* eligibility.applies(sessionId)))
          return refused(
            "This Session's work doesn't land as a Stack: its Project is off GitHub, opted out of Stacks, or `gh` isn't ready. Land the ticket as the repo's docs say.",
          );
        const session = (yield* hosted.worktrees).find(
          (w) => w.id === sessionId,
        );
        if (!session)
          return refused("Fern doesn't know this Session's worktree.");
        const repo = session.worktree;
        const found = yield* commitOf(repo, reported).pipe(Effect.option);
        if (Option.isNone(found))
          return refused(
            `${reported} isn't a commit in this repository. Report the merge commit's full hash.`,
          );
        const commit = found.value;
        if (!(yield* isAncestor(repo, commit, `refs/heads/${session.branch}`)))
          return refused(
            `${reported} isn't on this Session's branch, ${session.branch}. Merge the ticket into it, then report the merge commit.`,
          );

        const stack = yield* prs(sessionId);
        const already = stack.find((pr) => pr.ticket === ticket);
        if (already)
          return {
            text: `Ticket #${ticket} is already up as PR #${already.number} (${already.url}).`,
            isError: false,
          };
        const below = stack.at(-1);
        if (below && !(yield* isAncestor(repo, below.mergeCommit, commit)))
          return refused(
            `${reported} doesn't build on PR #${below.number} (ticket #${below.ticket ?? "?"}), the top of the Stack. Report tickets in the order they merged into this Session's branch.`,
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

        const title = yield* titleOf(session.cwd, ticket);
        const branch = `fern/${session.branch}/t${ticket}`;
        const base = below?.branch ?? TRUNK;
        yield* codeHost.push(session.cwd, { commit, branch });
        const opened = yield* codeHost.openDraft(session.cwd, {
          head: branch,
          base,
          title,
          body: openingBody(ticket),
        });
        const pr: StackPr = {
          id: crypto.randomUUID(),
          sessionId,
          position: stack.length + 1,
          ticket,
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
          text: `Ticket #${ticket} is up as draft PR #${opened.number} (${opened.url}), based on ${base}.${written} Carry on with the next ticket.`,
          isError: false,
        };
      });

      const landed = (
        sessionId: string,
        report: { readonly ticket: number; readonly commit: string },
      ) =>
        reporting
          .withPermits(1)(put(sessionId, report))
          .pipe(
            Effect.catchTags({
              CodeHostError: (error) =>
                Effect.succeed(
                  refused(
                    `Fern couldn't put ticket #${report.ticket} up on GitHub (${error.message}). Report it again once that's fixed.`,
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

      const run = Effect.runPromiseWith(yield* Effect.context());
      yield* tools.register({
        steering: STEERING,
        when: (sessionId) => eligibility.applies(sessionId),
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
              commit: z
                .string()
                .regex(/^[0-9a-f]{7,64}$/i)
                .describe(
                  "The full hash of the ticket's merge commit on this Session's branch",
                ),
            },
            (args) => run(landed(sessionId, args).pipe(Effect.map(reply))),
          ),
        ],
      });

      return Stacks.of({ prs, landed });
    }),
  ).pipe(Layer.provide(Git.layer));
}
