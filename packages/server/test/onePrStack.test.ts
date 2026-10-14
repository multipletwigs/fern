import { assert, layer } from "@effect/vitest";
import {
  type Checkpoint,
  FernApi,
  type Flow,
  LiveRpcs,
  type Phase,
  type Walkthrough,
  WalkthroughError,
} from "@repo/api";
import { Deferred, Effect, Layer, Schedule, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { RpcTest } from "effect/rpc";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { vi } from "vitest";
import {
  CodeHost,
  CodeHostError,
  MergeRefused,
} from "../src/codehost/CodeHost";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import {
  WalkthroughWriter,
  type WriteRequest,
} from "../src/walkthrough/WalkthroughWriter";
import { CleanupInterval } from "../src/worktree/WorktreeCleanup";
import { WorktreesDir } from "../src/worktree/Worktrees";
import { FakeIssues, NotListing } from "./stubs";

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd, encoding: "utf8" },
  ).trim();

const configDir = mkdtempSync(join(tmpdir(), "fern-claude-"));
process.env.CLAUDE_CONFIG_DIR = configDir;
const dataDir = realpathSync(mkdtempSync(join(tmpdir(), "fern-data-")));

// What Claude Code writes when it starts a Session: its transcript, under the folder it runs in.
const transcript = (
  cwd: string,
  id: string,
  text: string,
  entrypoint: string,
) => {
  const file = join(
    configDir,
    "projects",
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
    `${id}.jsonl`,
  );
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({
      type: "user",
      uuid: crypto.randomUUID(),
      parentUuid: null,
      sessionId: id,
      timestamp: new Date().toISOString(),
      cwd,
      entrypoint,
      userType: "external",
      message: { role: "user", content: text },
    })}\n`,
  );
};

// A Project of its own on GitHub: a repo on `main` with one commit, where the developer has run a
// Session.
const project = () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "fern-repo-")));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Initial");
  git(repo, "remote", "add", "origin", "git@github.com:acme/app.git");
  transcript(repo, crypto.randomUUID(), "Earlier work", "cli");
  return repo;
};

// What the agent commits on the Session's branch. The commit's hash.
const commit = (cwd: string, files: Record<string, string>) => {
  for (const [path, content] of Object.entries(files))
    writeFileSync(join(cwd, path), content);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "On the Session's branch");
  return git(cwd, "rev-parse", "HEAD");
};

// The code host, faked: what Fern asked it, in order, by the folder it asked from. A PR is merged
// once Fern merged it, unless `refusal` is set, when GitHub refuses with it. A push from a folder
// in `pushFailsFrom` fails; one from a folder in `pushWaitsFrom` waits for its Deferred first.
interface Asked {
  readonly cwd: string;
  readonly call: string;
  readonly args: Record<string, unknown>;
}
const asked: Array<Asked> = [];
const merged = new Set<number>();
let refusal: string | undefined;
const pushFailsFrom = new Set<string>();
const pushWaitsFrom = new Map<string, Deferred.Deferred<void>>();
let nextPr = 700;
const askedFrom = (cwd: string, ...calls: Array<string>) =>
  asked
    .filter((a) => a.cwd === cwd && calls.includes(a.call))
    .map(({ call, args }) => ({ call, args }));
const FakeCodeHost = Layer.succeed(
  CodeHost,
  CodeHost.of({
    ...NotListing,
    ready: () => Effect.succeed(true),
    defaultBranch: () => Effect.succeed("main"),
    push: (cwd, args) =>
      Effect.suspend(() => {
        const waiting = pushWaitsFrom.get(cwd);
        return waiting ? Deferred.await(waiting) : Effect.void;
      }).pipe(
        Effect.andThen(() =>
          pushFailsFrom.has(cwd)
            ? Effect.fail(new CodeHostError({ message: "Network is down" }))
            : Effect.sync(() => {
                asked.push({ cwd, call: "push", args });
              }),
        ),
      ),
    openDraft: (cwd, args) =>
      Effect.sync(() => {
        const number = ++nextPr;
        asked.push({ cwd, call: "openDraft", args: { ...args, number } });
        return { number, url: `https://github.com/acme/app/pull/${number}` };
      }),
    link: (cwd, prs) =>
      Effect.sync(() => {
        asked.push({
          cwd,
          call: "link",
          args: { prs: prs.map((pr) => pr.number) },
        });
      }),
    setBody: (cwd, pr, body) =>
      Effect.sync(() => {
        asked.push({ cwd, call: "setBody", args: { pr, body } });
      }),
    markReady: (cwd, prs) =>
      Effect.sync(() => {
        asked.push({
          cwd,
          call: "markReady",
          args: { prs: prs.map((pr) => pr.number) },
        });
      }),
    merge: (cwd, prs) =>
      Effect.suspend(() => {
        asked.push({
          cwd,
          call: "merge",
          args: { prs: prs.map((pr) => pr.number) },
        });
        if (refusal !== undefined)
          return Effect.fail(new MergeRefused({ reason: refusal }));
        for (const pr of prs) merged.add(pr.number);
        return Effect.void;
      }),
    state: (_cwd, prs) =>
      Effect.sync(() => ({
        merged: prs.every((pr) => merged.has(pr.number)),
      })),
  }),
);

// The Walkthrough writer, faked: it claims every hunk in one Section, titled for the files it
// touches, that says it fixes the first open Rejection, if any, once `gate` (if a test set one)
// opens. It fails on a change to a file in `failingOn`.
const requests: Array<WriteRequest> = [];
let gate: Deferred.Deferred<void> | undefined;
const failingOn = new Set<string>();
const Writer = Layer.succeed(
  WalkthroughWriter,
  WalkthroughWriter.of({
    write: (request: WriteRequest) =>
      Effect.gen(function* () {
        if (gate) yield* Deferred.await(gate);
        requests.push(request);
        if (request.hunks.some((h) => failingOn.has(h.path)))
          return yield* new WalkthroughError({ message: "The Fork crashed." });
        const draft = {
          sections: [
            {
              title: `Changes ${[...new Set(request.hunks.map((h) => h.path))].join(", ")}`,
              explanation: "Makes the change.",
              hunks: request.hunks.map((h) => h.id),
              decisions: [],
              risk: { level: "low" as const, reason: "Small." },
              fixes: request.rejections[0]?.id,
            },
          ],
          notFromSession: [],
        };
        return { draft, revise: () => Effect.succeed(draft) };
      }),
  }),
);

interface ToolResult {
  readonly content: ReadonlyArray<{ type: string; text: string }>;
  readonly isError?: boolean;
}
interface FernTool {
  readonly inputSchema: { parse: (args: unknown) => unknown };
  readonly handler: (args: unknown, extra: unknown) => Promise<ToolResult>;
}
interface TurnOptions {
  readonly cwd: string;
  readonly sessionId?: string;
  readonly systemPrompt?: { append?: string };
  readonly mcpServers?: Record<
    string,
    { instance: { _registeredTools: Record<string, FernTool> } }
  >;
}

// Each turn Claude Code is asked to run, and how to end it.
interface StartedTurn {
  readonly sessionId: string | undefined;
  readonly text: string;
  readonly options: TurnOptions;
  readonly finish: () => void;
}
const started: Array<StartedTurn> = [];

// Only the Agent SDK's query() is faked: it records the turn, writes the transcript as Claude Code
// would, and runs until the test, playing the agent, ends it.
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const { scriptedQuery } = await import("./fakeClaude");
  return {
    ...(await importOriginal<object>()),
    query: scriptedQuery<TurnOptions>(({ sessionId, text, options, first }) => {
      const { promise: ended, resolve: finish } = Promise.withResolvers<void>();
      if (first && options.sessionId)
        transcript(options.cwd, options.sessionId, text, "sdk-ts");
      started.push({ sessionId, text, options, finish });
      return ended;
    }),
  };
});

const makeClient = HttpApiTest.groups(FernApi, [
  "sessions",
  "flows",
  "walkthroughs",
]);
const makeLive = RpcTest.makeClient(LiveRpcs);

const fern = Layer.mergeAll(
  handlersWith(Writer, FakeIssues, FakeCodeHost).pipe(
    Layer.provide([
      DatabaseLive(join(dataDir, "fern.db")),
      Layer.succeed(WorktreesDir, { dir: dataDir }),
      // Look for landed Stacks often, rather than every few minutes.
      Layer.succeed(CleanupInterval, "100 millis"),
    ]),
  ),
  HttpServer.layerServices,
);

// The agent calls one of Fern's tools, as Claude Code would: input checked against its schema,
// then handled.
const callTool = (turn: StartedTurn, name: string, args: unknown) =>
  Effect.promise(() => {
    // oxlint-disable-next-line no-underscore-dangle -- the MCP server's own registry
    const tool = turn.options.mcpServers?.fern?.instance._registeredTools[name];
    if (!tool) throw new Error(`No Fern tool ${name}`);
    return tool.handler(tool.inputSchema.parse(args), {});
  });
const textOf = (result: ToolResult) =>
  result.content.map((c) => c.text).join("");

// The Session's turn on the first message Fern sent it that satisfies the predicate.
const turnWhere = (id: string, predicate: (text: string) => boolean) =>
  Effect.suspend(() =>
    Effect.fromNullishOr(
      started.find((t) => t.sessionId === id && predicate(t.text)),
    ),
  ).pipe(
    Effect.retry({ schedule: Schedule.spaced("5 millis"), times: 600 }),
    Effect.orDie,
  );

// The first value of the live stream that satisfies the condition.
const firstWhere = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
  condition: (a: A) => boolean,
) =>
  stream.pipe(
    Stream.filter(condition),
    Stream.take(1),
    Stream.runCollect,
    Effect.timeout("5 seconds"),
    Effect.orDie,
    Effect.map((all) => all[0]),
  );

const flowWhen = (id: string, condition: (flow: Flow | null) => boolean) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    return yield* firstWhere(live.Flow({ session: id }), condition);
  });

const walkthroughsWhen = (
  id: string,
  condition: (all: ReadonlyArray<Walkthrough>) => boolean,
) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    return (
      (yield* firstWhere(live.Walkthroughs({ session: id }), condition)) ?? []
    );
  });

// The Session's Land Checkpoint once it satisfies the condition.
const landWhen = (id: string, condition: (land: Checkpoint) => boolean) =>
  flowWhen(
    id,
    (f) => f?.checkpoint?.kind === "land" && condition(f.checkpoint),
  ).pipe(Effect.map((f) => f?.checkpoint));

// Every Walkthrough of the Session written, and as many as `count`.
const written = (id: string, count: number) =>
  walkthroughsWhen(
    id,
    (ws) => ws.length === count && ws.every((w) => w.status === "ready"),
  );

const skip = (id: string, phase: Phase) =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    yield* client.flows.skip({
      params: { session: id },
      payload: { phase, reason: "Too small for it" },
    });
  });

// A new Session in a GitHub Project, with Grill and Spec skipped, so it has no tickets: its turn on
// `/implement-spec`, and the Session's branch.
const ticketless = (root = project()) =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    const { id } = yield* client.sessions.start({
      payload: { root, message: { text: "Fix the typo in the README" } },
    });
    const first = yield* turnWhere(id, () => true);
    const cwd = first.options.cwd;
    first.finish();
    yield* skip(id, "grill");
    (yield* turnWhere(id, (text) => text === "/to-spec")).finish();
    const tickets = yield* turnWhere(id, (text) => text === "/to-tickets");
    yield* skip(id, "spec");
    tickets.finish();
    const turn = yield* turnWhere(id, (text) =>
      text.startsWith("/implement-spec"),
    );
    return { id, cwd, turn, branch: git(cwd, "branch", "--show-current") };
  });

// The agent reports the Phase done in the turn, then ends the turn; the developer approves the
// Checkpoint Fern raises.
const doneAndApproved = (id: string, turn: StartedTurn, phase: string) =>
  Effect.gen(function* () {
    yield* callTool(turn, "phase_done", { phase, summary: `${phase} done.` });
    turn.finish();
    const flow = yield* flowWhen(id, (f) => f?.checkpoint?.phase === phase);
    const client = yield* makeClient;
    yield* client.flows.approve({ params: { id: flow?.checkpoint?.id ?? "" } });
  });

// The developer approves every Section and Unexplained change of the Session's written
// Walkthroughs that has no verdict yet.
const approveAll = (id: string) =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    const all = yield* walkthroughsWhen(id, (ws) =>
      ws.every((w) => w.status !== "writing"),
    );
    for (const done of all.filter((w) => w.status === "ready"))
      for (const item of [
        ...done.sections.filter((s) => !s.verdict).map((s) => s.id),
        ...done.unexplained.filter((u) => !u.verdict).map((u) => u.hunk.id),
      ])
        yield* client.walkthroughs.verdict({
          params: { id: done.id, item },
          payload: { kind: "approved" },
        });
  });

const waits = (flow: Flow | null | undefined) =>
  flow?.landWaitsOn?.map((w) => [w.pr?.number, w.why]);

layer(fern, { excludeTestServices: true })("A Stack of one PR", (it) => {
  it.effect(
    "a Session without tickets opens one draft PR with its first Walkthrough: the Session's branch tip pushed to a branch of its own, based on main",
    () =>
      Effect.gen(function* () {
        const { id, cwd, turn, branch } = yield* ticketless();
        const tip = commit(cwd, { "README.md": "# The app\n" });
        turn.finish();

        const [first] = yield* written(id, 1);
        assert.deepStrictEqual(askedFrom(cwd, "push", "openDraft"), [
          {
            call: "push",
            args: { commit: tip, branch: `fern/${branch}/session` },
          },
          {
            call: "openDraft",
            args: {
              head: `fern/${branch}/session`,
              base: "main",
              title: "Fix the typo in the README",
              body: "Fern is writing this PR's Walkthrough.",
              number: first?.pr?.number,
            },
          },
        ]);
        assert.isDefined(first?.pr);
        assert.isUndefined(first?.pr?.ticket);
        assert.deepStrictEqual(
          first?.sections.flatMap((s) => s.hunks.map((h) => h.path)),
          ["README.md"],
        );
      }),
  );

  it.effect(
    "each later Walkthrough covers what was committed since the previous one and moves the PR's branch to the new tip, and the PR's description covers every Walkthrough of it, oldest first",
    () =>
      Effect.gen(function* () {
        const { id, cwd, turn, branch } = yield* ticketless();
        const first = commit(cwd, { "README.md": "# The app\n" });
        turn.finish();
        const [one] = yield* written(id, 1);
        const client = yield* makeClient;
        yield* client.sessions.send({
          params: { id },
          payload: { text: "Mention the licence too" },
        });
        const next = yield* turnWhere(id, (text) => text.includes("licence"));
        const second = commit(cwd, { LICENSE: "MIT\n" });
        next.finish();

        const [, two] = yield* written(id, 2);
        const pr = one?.pr?.number;
        assert.strictEqual(two?.pr?.number, pr);
        assert.strictEqual(two?.since, "previous");
        assert.deepStrictEqual(
          two?.sections.flatMap((s) => s.hunks.map((h) => h.path)),
          ["LICENSE"],
        );
        assert.deepStrictEqual(askedFrom(cwd, "push"), [
          {
            call: "push",
            args: { commit: first, branch: `fern/${branch}/session` },
          },
          {
            call: "push",
            args: {
              commit: second,
              branch: `fern/${branch}/session`,
              replacing: first,
            },
          },
        ]);
        const bodies = askedFrom(cwd, "setBody").map((a) => a.args);
        assert.strictEqual(bodies.length, 2);
        assert.include(String(bodies[0]?.body), "## Changes README.md");
        assert.deepStrictEqual(bodies[1]?.pr, pr);
        // The PR carries both changes, so its description covers both Walkthroughs, oldest first.
        const both = String(bodies[1]?.body);
        assert.isAtLeast(both.indexOf("## Changes README.md"), 0);
        assert.isAbove(
          both.indexOf("## Changes LICENSE"),
          both.indexOf("## Changes README.md"),
        );
        assert.notInclude(both, "Closes #");
      }),
  );

  it.effect(
    "the one PR lands through the Land Checkpoint once Retro is over and its Walkthroughs are Reviewed, and the merged PR archives the Session",
    () =>
      Effect.gen(function* () {
        const { id, cwd, turn } = yield* ticketless();
        commit(cwd, { "README.md": "# The app\n" });
        yield* doneAndApproved(id, turn, "implement");
        const implement = yield* flowWhen(
          id,
          (f) => f?.phases[2]?.status === "done",
        );
        yield* doneAndApproved(
          id,
          yield* turnWhere(id, (text) => text === "/retro"),
          "retro",
        );
        // Once the agent's Retro turn is over, only the review is left.
        const waiting = yield* flowWhen(
          id,
          (f) => f?.landWaitsOn?.length === 1,
        );
        yield* approveAll(id);
        const opened = yield* landWhen(id, () => true);
        const pr = opened?.land?.prs[0]?.number;
        const client = yield* makeClient;
        yield* client.flows.approve({ params: { id: opened?.id ?? "" } });
        const live = yield* makeLive;
        yield* firstWhere(live.Projects(), (all) =>
          all.every((p) => p.sessions.every((s) => s.id !== id)),
        );

        assert.isDefined(implement);
        assert.deepStrictEqual(waits(waiting), [
          [pr, "Its Walkthrough isn't Reviewed yet: 1 left to review."],
        ]);
        assert.deepStrictEqual(
          opened?.land?.prs.map((p) => p.number),
          [pr],
        );
        assert.deepStrictEqual(askedFrom(cwd, "markReady", "merge"), [
          { call: "markReady", args: { prs: [pr] } },
          { call: "merge", args: { prs: [pr] } },
        ]);
      }),
  );

  it.effect(
    "uncommitted changes are in neither the PR nor its Walkthroughs: Implement isn't done while there are any, and Land waits on them, saying so",
    () =>
      Effect.gen(function* () {
        const { id, cwd, turn } = yield* ticketless();
        commit(cwd, { "README.md": "# The app\n" });
        writeFileSync(join(cwd, "notes.md"), "Half done\n");
        const refused = yield* callTool(turn, "phase_done", {
          phase: "implement",
          summary: "Done.",
        });
        turn.finish();
        const [one] = yield* written(id, 1);
        git(cwd, "clean", "-fdq");
        const client = yield* makeClient;
        yield* client.sessions.send({
          params: { id },
          payload: { text: "Drop the notes" },
        });
        yield* doneAndApproved(
          id,
          yield* turnWhere(id, (text) => text === "Drop the notes"),
          "implement",
        );
        yield* doneAndApproved(
          id,
          yield* turnWhere(id, (text) => text === "/retro"),
          "retro",
        );
        yield* flowWhen(id, (f) => f?.landWaitsOn?.length === 1);
        writeFileSync(join(cwd, "scratch.ts"), "export const s = 1;\n");
        yield* approveAll(id);
        const dirty = yield* flowWhen(id, (f) =>
          (f?.landWaitsOn ?? []).some((w) =>
            w.why.includes("aren't committed"),
          ),
        );
        yield* client.sessions.send({
          params: { id },
          payload: { text: "Commit the scratch file" },
        });
        const last = yield* turnWhere(id, (text) => text.startsWith("Commit"));
        commit(cwd, {});
        last.finish();
        const [, two] = yield* written(id, 2);
        yield* approveAll(id);
        const opened = yield* landWhen(id, () => true);

        assert.isTrue(refused.isError);
        assert.include(textOf(refused), "aren't committed");
        assert.deepStrictEqual(
          one?.sections.flatMap((s) => s.hunks.map((h) => h.path)),
          ["README.md"],
        );
        assert.deepStrictEqual(waits(dirty), [
          [
            one?.pr?.number,
            "The Session's worktree has changes that aren't committed, and its PR carries only what's committed. Commit them on the Session's branch, or throw them away.",
          ],
        ]);
        assert.deepStrictEqual(
          two?.sections.flatMap((s) => s.hunks.map((h) => h.path)),
          ["scratch.ts"],
        );
        assert.deepStrictEqual(opened?.land?.waiting, []);
      }),
  );

  it.effect(
    "a Walkthrough the developer asks for goes to the one PR too, moving its branch",
    () =>
      Effect.gen(function* () {
        const { id, cwd, turn, branch } = yield* ticketless();
        const first = commit(cwd, { "README.md": "# The app\n" });
        turn.finish();
        const [one] = yield* written(id, 1);
        const second = commit(cwd, { "CHANGELOG.md": "# Changes\n" });
        const client = yield* makeClient;
        yield* client.walkthroughs.write({ payload: { session: id } });
        const [, two] = yield* written(id, 2);
        const nothing = yield* client.walkthroughs
          .write({ payload: { session: id } })
          .pipe(Effect.flip);

        assert.strictEqual(two?.pr?.number, one?.pr?.number);
        assert.deepStrictEqual(
          two?.sections.flatMap((s) => s.hunks.map((h) => h.path)),
          ["CHANGELOG.md"],
        );
        assert.deepStrictEqual(askedFrom(cwd, "push").at(-1)?.args, {
          commit: second,
          branch: `fern/${branch}/session`,
          replacing: first,
        });
        assert.strictEqual(nothing._tag, "NothingToReview");
      }),
  );

  it.effect(
    "a Rejection goes back to the Session to fix on its branch, and the next Walkthrough of the one PR says it fixes it",
    () =>
      Effect.gen(function* () {
        const { id, cwd, turn } = yield* ticketless();
        commit(cwd, { "README.md": "# The app\n" });
        turn.finish();
        const [one] = yield* written(id, 1);
        const client = yield* makeClient;
        yield* client.walkthroughs.verdict({
          params: { id: one?.id ?? "", item: "s1" },
          payload: { kind: "rejected", note: "Name the app." },
        });
        const redirect = yield* turnWhere(id, (text) =>
          text.startsWith("I reviewed Walkthrough"),
        );
        commit(cwd, { "README.md": "# Fern\n" });
        redirect.finish();
        const [, two] = yield* written(id, 2);

        assert.include(redirect.text, "Name the app.");
        assert.include(
          redirect.text,
          "commit the fix on this Session's branch",
        );
        assert.notInclude(redirect.text, "fix_landed");
        assert.strictEqual(two?.pr?.number, one?.pr?.number);
        assert.deepStrictEqual(two?.sections[0]?.fixes, {
          walkthrough: one?.number ?? 0,
          title: "Changes README.md",
        });
      }),
  );

  it.effect(
    "a Session is told its work goes up as one PR when it has no tickets, and reporting a ticket once it has none is refused",
    () =>
      Effect.gen(function* () {
        const { turn, cwd } = yield* ticketless();
        const reported = yield* callTool(turn, "ticket_landed", {
          ticket: 3,
          commit: commit(cwd, { "README.md": "# The app\n" }),
        });

        assert.isTrue(reported.isError);
        assert.include(textOf(reported), "no tickets");
        assert.include(turn.options.systemPrompt?.append ?? "", "one draft PR");
        assert.deepStrictEqual(askedFrom(cwd, "push", "openDraft"), []);
      }),
  );

  it.effect(
    "the end of Implement waits for the Walkthrough of what was committed since the last one, and its Checkpoint links to that one, not the one before",
    () =>
      Effect.gen(function* () {
        const { id, cwd, turn } = yield* ticketless();
        commit(cwd, { "README.md": "# The app\n" });
        turn.finish();
        yield* written(id, 1);
        const client = yield* makeClient;
        yield* client.sessions.send({
          params: { id },
          payload: { text: "Add a licence, then you're done" },
        });
        const next = yield* turnWhere(id, (text) => text.includes("licence"));
        commit(cwd, { LICENSE: "MIT\n" });
        const opened = yield* Deferred.make<void>();
        gate = opened;
        const held = yield* callTool(next, "phase_done", {
          phase: "implement",
          summary: "Done.",
        });
        next.finish();
        yield* Effect.sleep("300 millis");
        const waiting = yield* flowWhen(id, () => true);
        gate = undefined;
        yield* Deferred.succeed(opened, undefined);
        const raised = yield* flowWhen(
          id,
          (f) => f?.checkpoint?.phase === "implement",
        );

        assert.include(textOf(held), "writing the Session's Walkthrough");
        assert.isUndefined(waiting?.checkpoint);
        assert.strictEqual(raised?.checkpoint?.walkthrough?.number, 2);
      }).pipe(Effect.ensuring(Effect.sync(() => (gate = undefined)))),
  );

  it.effect(
    "when the Walkthrough the end of Implement waits on can't be written, there's no Checkpoint, and the agent hears why",
    () =>
      Effect.gen(function* () {
        failingOn.add("broken.md");
        const { id, cwd, turn } = yield* ticketless();
        commit(cwd, { "broken.md": "# Broken\n" });
        yield* callTool(turn, "phase_done", {
          phase: "implement",
          summary: "Done.",
        });
        turn.finish();
        const told = yield* turnWhere(id, (text) =>
          text.startsWith("Fern couldn't write the Session's Walkthrough"),
        );
        const flow = yield* flowWhen(id, () => true);

        assert.include(told.text, "The Fork crashed.");
        assert.isUndefined(flow?.checkpoint);
      }).pipe(Effect.ensuring(Effect.sync(() => failingOn.clear()))),
  );

  it.effect(
    "a push GitHub doesn't take stores no Walkthrough, and the next write covers what it missed",
    () =>
      Effect.gen(function* () {
        const { id, cwd, turn, branch } = yield* ticketless();
        const first = commit(cwd, { "README.md": "# The app\n" });
        turn.finish();
        yield* written(id, 1);
        pushFailsFrom.add(cwd);
        const client = yield* makeClient;
        const second = commit(cwd, { LICENSE: "MIT\n" });
        const failed = yield* client.walkthroughs
          .write({ payload: { session: id } })
          .pipe(Effect.flip);
        const after = yield* walkthroughsWhen(id, () => true);
        pushFailsFrom.delete(cwd);
        yield* client.walkthroughs.write({ payload: { session: id } });
        const [, two] = yield* written(id, 2);

        assert.strictEqual(failed._tag, "WalkthroughError");
        assert.strictEqual(after.length, 1);
        assert.deepStrictEqual(
          two?.sections.flatMap((s) => s.hunks.map((h) => h.path)),
          ["LICENSE"],
        );
        assert.deepStrictEqual(askedFrom(cwd, "push").at(-1)?.args, {
          commit: second,
          branch: `fern/${branch}/session`,
          replacing: first,
        });
      }).pipe(Effect.ensuring(Effect.sync(() => pushFailsFrom.clear()))),
  );

  it.effect("one Session's slow push holds up no other Session's PR", () =>
    Effect.gen(function* () {
      const slow = yield* ticketless();
      const quick = yield* ticketless();
      const pushed = yield* Deferred.make<void>();
      pushWaitsFrom.set(slow.cwd, pushed);
      commit(slow.cwd, { "README.md": "# Slow\n" });
      slow.turn.finish();
      yield* Effect.sleep("100 millis");
      commit(quick.cwd, { "README.md": "# Quick\n" });
      quick.turn.finish();
      const [done] = yield* written(quick.id, 1);
      const waiting = yield* walkthroughsWhen(slow.id, () => true);
      pushWaitsFrom.delete(slow.cwd);
      yield* Deferred.succeed(pushed, undefined);
      yield* written(slow.id, 1);

      assert.isDefined(done?.pr);
      assert.deepStrictEqual(waiting, []);
    }).pipe(Effect.ensuring(Effect.sync(() => pushWaitsFrom.clear()))),
  );

  it.effect(
    "after GitHub refuses the one PR, the agent is told to commit the fix on the Session's branch, and Land waits for the Walkthrough of it to be Reviewed",
    () =>
      Effect.gen(function* () {
        const { id, cwd, turn } = yield* ticketless();
        commit(cwd, { "README.md": "# The app\n" });
        yield* doneAndApproved(id, turn, "implement");
        yield* doneAndApproved(
          id,
          yield* turnWhere(id, (text) => text === "/retro"),
          "retro",
        );
        yield* flowWhen(id, (f) => f?.landWaitsOn?.length === 1);
        yield* approveAll(id);
        const opened = yield* landWhen(id, () => true);
        const client = yield* makeClient;
        refusal = "The PR has conflicts with main.";
        yield* client.flows.approve({ params: { id: opened?.id ?? "" } });
        yield* landWhen(
          id,
          (c) => c.land?.refusal !== undefined && !c.land.landing,
        );
        yield* client.flows.send({ params: { id: opened?.id ?? "" } });
        const sent = yield* turnWhere(id, (text) =>
          text.startsWith("GitHub refused"),
        );
        refusal = undefined;
        commit(cwd, { "README.md": "# The app, without conflicts\n" });
        sent.finish();
        yield* written(id, 2);
        const held = yield* landWhen(
          id,
          (c) => (c.land?.waiting.length ?? 0) > 0,
        );
        const early = yield* client.flows
          .approve({ params: { id: opened?.id ?? "" } })
          .pipe(Effect.flip);
        yield* approveAll(id);
        yield* landWhen(id, (c) => c.land?.waiting.length === 0);
        yield* client.flows.approve({ params: { id: opened?.id ?? "" } });
        yield* flowWhen(id, (f) => f?.checkpoint === undefined);

        assert.include(sent.text, "commit the fix on this Session's branch");
        assert.notInclude(sent.text, "prs_updated");
        assert.deepStrictEqual(
          held?.land?.waiting.map((w) => w.why),
          ["Its Walkthrough isn't Reviewed yet: 1 left to review."],
        );
        assert.strictEqual(early._tag, "LandNotReady");
        assert.strictEqual(askedFrom(cwd, "merge").length, 2);
      }).pipe(Effect.ensuring(Effect.sync(() => (refusal = undefined)))),
  );

  it.effect(
    "a Session whose Spec wrote tickets never goes up as one PR: its turns open no PR and write no Walkthrough, and each ticket opens its own",
    () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const { id } = yield* client.sessions.start({
          payload: { root: project(), message: { text: "Add dark mode" } },
        });
        const grill = yield* turnWhere(id, () => true);
        const cwd = grill.options.cwd;
        yield* doneAndApproved(id, grill, "grill");
        (yield* turnWhere(id, (text) => text === "/to-spec")).finish();
        const tickets = yield* turnWhere(id, (text) => text === "/to-tickets");
        yield* callTool(tickets, "phase_done", {
          phase: "spec",
          summary: "Spec done.",
          spec: { brief: 2, tickets: [3, 4] },
        });
        tickets.finish();
        const spec = yield* flowWhen(
          id,
          (f) => f?.checkpoint?.phase === "spec",
        );
        yield* client.flows.approve({
          params: { id: spec?.checkpoint?.id ?? "" },
        });
        const implement = yield* turnWhere(id, (text) =>
          text.startsWith("/implement-spec"),
        );
        const tip = commit(cwd, { "theme.ts": "export const theme = 1;\n" });
        implement.finish();
        yield* Effect.sleep("300 millis");
        const quiet = yield* walkthroughsWhen(id, () => true);
        const before = askedFrom(cwd, "push", "openDraft");
        const next = yield* client.sessions
          .send({ params: { id }, payload: { text: "Report it" } })
          .pipe(Effect.andThen(turnWhere(id, (text) => text === "Report it")));
        const reported = yield* callTool(next, "ticket_landed", {
          ticket: 3,
          commit: tip,
        });

        assert.deepStrictEqual(quiet, []);
        assert.deepStrictEqual(before, []);
        assert.isUndefined(reported.isError);
        assert.include(
          next.options.systemPrompt?.append ?? "",
          "ticket_landed",
        );
        assert.strictEqual(
          askedFrom(cwd, "openDraft")[0]?.args.head,
          `fern/${git(cwd, "branch", "--show-current")}/t3`,
        );
      }),
  );
});
