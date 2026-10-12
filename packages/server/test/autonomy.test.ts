import { assert, layer } from "@effect/vitest";
import {
  type BoundaryAutonomy,
  FernApi,
  LiveRpcs,
  type SessionAutonomy,
} from "@repo/api";
import { Effect, Layer, Schedule, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { RpcTest } from "effect/rpc";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import { WorktreesDir } from "../src/worktree/Worktrees";
import { FakeIssues, NoWriter } from "./stubs";

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
  entrypoint = "sdk-ts",
) => {
  const dir = join(configDir, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.jsonl`),
    `${JSON.stringify({
      type: "user",
      uuid: crypto.randomUUID(),
      parentUuid: null,
      sessionId: id,
      timestamp: new Date(Date.now() - 60_000).toISOString(),
      cwd,
      entrypoint,
      userType: "external",
      message: { role: "user", content: text },
    })}\n`,
  );
};

// A Project of its own: a repo on `main` with one commit, where the developer has run a Session.
const project = () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "fern-repo-")));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Initial");
  transcript(repo, crypto.randomUUID(), "Earlier work", "cli");
  return repo;
};

// One turn Claude Code is asked to run: on which Session, and its first message.
interface StartedTurn {
  readonly sessionId: string;
  readonly text: string;
  readonly options: Record<string, unknown>;
}
const started: Array<StartedTurn> = [];

interface ToolServer {
  readonly instance: {
    readonly _registeredTools: Record<
      string,
      {
        readonly handler: (
          args: Record<string, unknown>,
          extra: unknown,
        ) => Promise<unknown>;
      }
    >;
  };
}

// Calls a Fern tool the way Claude Code would: through the in-process MCP server Fern passed.
const call = async (
  options: Record<string, unknown>,
  name: string,
  args: Record<string, unknown>,
) => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const servers = options.mcpServers as Record<string, ToolServer>;
  // oxlint-disable-next-line no-underscore-dangle
  const tool = servers.fern?.instance._registeredTools[name];
  if (!tool) throw new Error(`No Fern tool ${name}`);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const answer = (await tool.handler(args, {})) as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  return {
    text: answer.content.map((c) => c.text).join(""),
    isError: answer.isError === true,
  };
};

// What the agent reports with Spec and with Retro, and the Phases it doesn't report done at all;
// a test may change these and puts them back after.
const GOOD_SPEC = { brief: 2, tickets: [3, 4] };
let specReport: { brief: number; tickets: Array<number> } = GOOD_SPEC;
let retroFindings: Array<{ title: string; change: string; reasoning: string }> =
  [];
let silent: ReadonlySet<string> = new Set();
// Fern's answers to the agent's Phase-done reports, by Session.
const answers: Array<{ sessionId: string; text: string; isError: boolean }> =
  [];
const restoring = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.ensuring(
    effect,
    Effect.sync(() => {
      specReport = GOOD_SPEC;
      retroFindings = [];
      silent = new Set();
    }),
  );

// The agent follows the Flow: it reports each Phase done at the end of the turn its command
// started, and reports a declined Phase done again once it has the developer's note.
const agent = async ({ sessionId, text, options }: StartedTurn) => {
  const report = async (phase: string) => {
    if (silent.has(phase)) return;
    const answer = await call(options, "phase_done", {
      phase,
      summary: `${phase} done.`,
      ...(phase === "spec" ? { spec: specReport } : {}),
      ...(phase === "retro" && retroFindings.length > 0
        ? { findings: retroFindings }
        : {}),
    });
    answers.push({ sessionId, ...answer });
  };
  if (text.startsWith("/grill-with-docs")) await report("grill");
  else if (text === "/to-tickets") await report("spec");
  else if (text.startsWith("/implement-spec")) await report("implement");
  else if (text === "/retro") await report("retro");
  else if (text.includes("declined the Checkpoint at the end of Spec"))
    await report("spec");
  else if (text.includes("declined the Checkpoint at the end of Implement"))
    await report("implement");
};

// Only the Agent SDK's query() is faked: it records the turn, writes the transcript as Claude Code
// would, lets the agent act, then ends the turn.
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  query: ({
    prompt,
    options,
  }: {
    prompt: AsyncIterable<{ message: { content: Array<{ text?: string }> } }>;
    options: Record<string, unknown> & {
      cwd: string;
      sessionId?: string;
      resume?: string;
    };
  }) => {
    async function* events() {
      const first = await prompt[Symbol.asyncIterator]().next();
      const text = first.done
        ? ""
        : (first.value.message.content.find((part) => part.text)?.text ?? "");
      const sessionId = options.sessionId ?? options.resume ?? "";
      const turn = { sessionId, text, options };
      started.push(turn);
      if (options.sessionId) transcript(options.cwd, options.sessionId, text);
      yield { type: "system", subtype: "init", model: "claude-test" };
      await agent(turn);
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "",
        modelUsage: { "claude-test": { contextWindow: 1_000 } },
      };
    }
    return Object.assign(events(), {
      interrupt: () => Promise.resolve(),
      close: () => {},
    });
  },
}));

const makeClient = HttpApiTest.groups(FernApi, [
  "sessions",
  "flows",
  "autonomy",
]);
const makeLive = RpcTest.makeClient(LiveRpcs);

const server = Layer.mergeAll(
  handlersWith(NoWriter, FakeIssues).pipe(
    Layer.provide([
      DatabaseLive(join(mkdtempSync(join(tmpdir(), "fern-db-")), "fern.db")),
      Layer.succeed(WorktreesDir, { dir: dataDir }),
    ]),
  ),
  HttpServer.layerServices,
);

// The first value of the stream that satisfies the predicate.
const firstWhere = <A, E>(
  stream: Stream.Stream<A, E>,
  predicate: (a: A) => boolean,
) =>
  stream.pipe(
    Stream.filter(predicate),
    Stream.take(1),
    Stream.runCollect,
    Effect.map(([a]) => a),
    Effect.timeout("5 seconds"),
    Effect.orDie,
  );

// Waits until Claude Code has been asked to run a turn on the Session that satisfies the predicate.
const turnWhere = (
  sessionId: string,
  predicate: (turn: StartedTurn) => boolean,
) =>
  Effect.suspend(() =>
    Effect.fromNullishOr(
      started.find((t) => t.sessionId === sessionId && predicate(t)),
    ),
  ).pipe(
    Effect.retry({ schedule: Schedule.spaced("5 millis"), times: 400 }),
    Effect.orDie,
  );

const startSession = (root: string) =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    const { id } = yield* client.sessions.start({
      payload: { root, message: { text: "Add a dark mode toggle" } },
    });
    return id;
  });

// The Session's pending Checkpoint once the agent reports the Phase done.
const checkpointAt = (sessionId: string, phase: string) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    const flow = yield* firstWhere(
      live.Flow({ session: sessionId }),
      (f) => f?.checkpoint?.phase === phase,
    );
    return flow?.checkpoint?.id ?? "";
  });

const approveAt = (sessionId: string, phase: string) =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    const id = yield* checkpointAt(sessionId, phase);
    yield* client.flows.approve({ params: { id } });
  });

const declineAt = (sessionId: string, phase: string) =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    const id = yield* checkpointAt(sessionId, phase);
    yield* client.flows.decline({
      params: { id },
      payload: { note: "Not yet." },
    });
  });

// A new Session in the Project, taken through the Grill to its Spec Checkpoint.
const atSpecCheckpoint = (root: string) =>
  Effect.gen(function* () {
    const id = yield* startSession(root);
    yield* approveAt(id, "grill");
    yield* checkpointAt(id, "spec");
    return id;
  });

// A new Session in the Project whose Spec the developer approves with nothing declined.
const cleanSpecPass = (root: string) =>
  Effect.gen(function* () {
    const id = yield* atSpecCheckpoint(root);
    yield* approveAt(id, "spec");
    return id;
  });

const autonomyOf = (
  sessionId: string,
  predicate: (a: SessionAutonomy) => boolean = () => true,
) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    const autonomy = yield* firstWhere(
      live.Autonomy({ session: sessionId }),
      (a) => a !== null && predicate(a),
    );
    if (!autonomy) return assert.fail("no Autonomy");
    return autonomy;
  });

const at = (autonomy: SessionAutonomy, boundary: string) =>
  autonomy.boundaries.find((b) => b.boundary === boundary);

const streaks = (autonomy: SessionAutonomy) =>
  autonomy.boundaries.map(
    (b: BoundaryAutonomy) => `${b.boundary}:${b.streak}/${b.threshold}`,
  );

layer(server, { excludeTestServices: true })("Autonomy", (it) => {
  it.effect(
    "counts each Project's clean passes at the end of Spec and of Implement",
    () =>
      Effect.gen(function* () {
        const root = project();
        const other = project();
        yield* cleanSpecPass(root);
        const id = yield* cleanSpecPass(root);
        yield* approveAt(id, "implement");
        const elsewhere = yield* startSession(other);

        const autonomy = yield* autonomyOf(
          id,
          (a) => at(a, "implement")?.streak === 1,
        );
        assert.deepStrictEqual(streaks(autonomy), [
          "spec:2/5",
          "implement:1/5",
        ]);
        assert.strictEqual(autonomy.project, root);
        assert.deepStrictEqual(streaks(yield* autonomyOf(elsewhere)), [
          "spec:0/5",
          "implement:0/5",
        ]);
      }),
  );

  it.effect(
    "starts a boundary's streak over when a Checkpoint there is declined, and doesn't count that pass",
    () =>
      Effect.gen(function* () {
        const root = project();
        yield* cleanSpecPass(root);
        yield* cleanSpecPass(root);
        const id = yield* atSpecCheckpoint(root);
        yield* declineAt(id, "spec");

        assert.deepStrictEqual(
          streaks(yield* autonomyOf(id, (a) => at(a, "spec")?.streak === 0)),
          ["spec:0/5", "implement:0/5"],
        );
        // The agent reports Spec done again, and the developer approves it this time.
        yield* approveAt(id, "spec");
        const next = yield* cleanSpecPass(root);
        assert.deepStrictEqual(
          streaks(yield* autonomyOf(next, (a) => at(a, "spec")?.streak === 1)),
          ["spec:1/5", "implement:0/5"],
        );
      }),
  );

  it.effect(
    "offers a Milestone on the 5th clean pass in a row, and records the developer declining it",
    () =>
      Effect.gen(function* () {
        const root = project();
        for (let i = 0; i < 4; i++) yield* cleanSpecPass(root);
        const fourth = yield* autonomyOf(
          yield* startSession(root),
          (a) => at(a, "spec")?.streak === 4,
        );
        assert.isUndefined(at(fourth, "spec")?.offer);

        const id = yield* cleanSpecPass(root);
        const offered = yield* autonomyOf(
          id,
          (a) => at(a, "spec")?.offer !== undefined,
        );
        const offer = at(offered, "spec")?.offer;
        assert.strictEqual(offer?.boundary, "spec");
        assert.strictEqual(offer?.project, root);
        assert.strictEqual(offer?.status, "offered");
        assert.isFalse(at(offered, "spec")?.granted);
        assert.isUndefined(at(offered, "implement")?.offer);

        const client = yield* makeClient;
        yield* client.autonomy.decline({ params: { id: offer?.id ?? "" } });
        const declined = yield* autonomyOf(
          id,
          (a) => at(a, "spec")?.offer === undefined,
        );
        assert.deepStrictEqual(streaks(declined), [
          "spec:0/5",
          "implement:0/5",
        ]);
        assert.isFalse(at(declined, "spec")?.granted);
        // Decided once.
        const again = yield* client.autonomy
          .accept({ params: { id: offer?.id ?? "" } })
          .pipe(Effect.flip);
        assert.strictEqual(again._tag, "MilestoneClosed");
        const missing = yield* client.autonomy
          .accept({ params: { id: "no-such-milestone" } })
          .pipe(Effect.flip);
        assert.strictEqual(missing._tag, "MilestoneNotFound");
      }),
  );

  it.effect(
    "once the Milestone is accepted, Fern approves the end of Spec itself and sends the next command",
    () =>
      Effect.gen(function* () {
        const root = project();
        for (let i = 0; i < 4; i++) yield* cleanSpecPass(root);
        const fifth = yield* cleanSpecPass(root);
        const offer = at(
          yield* autonomyOf(fifth, (a) => at(a, "spec")?.offer !== undefined),
          "spec",
        )?.offer;
        const client = yield* makeClient;
        yield* client.autonomy.accept({ params: { id: offer?.id ?? "" } });
        const granted = yield* autonomyOf(
          fifth,
          (a) => at(a, "spec")?.granted === true,
        );
        assert.isUndefined(at(granted, "spec")?.offer);
        assert.isFalse(at(granted, "spec")?.approvedByFern);

        // The next Session reports Spec done: no Checkpoint waits, and Implement starts.
        const id = yield* startSession(root);
        yield* approveAt(id, "grill");
        yield* turnWhere(id, (t) => t.text === "/implement-spec #2");
        const live = yield* makeLive;
        const flow = yield* firstWhere(
          live.Flow({ session: id }),
          (f) => f?.phases[1]?.status === "done",
        );
        assert.deepStrictEqual(
          flow?.phases.map((p) => `${p.phase}:${p.status}`),
          ["grill:done", "spec:done", "implement:current", "retro:notStarted"],
        );
        // Implement isn't covered, so its Checkpoint waits on the developer.
        assert.strictEqual(flow?.checkpoint?.phase ?? "implement", "implement");
        const queue = yield* firstWhere(live.Checkpoints(), () => true);
        assert.isFalse(
          queue?.some((c) => c.sessionId === id && c.phase === "spec"),
        );
        const mine = yield* autonomyOf(
          id,
          (a) => at(a, "spec")?.approvedByFern === true,
        );
        assert.isFalse(at(mine, "implement")?.approvedByFern);
        // Passes Fern approves don't count towards a streak.
        assert.strictEqual(at(mine, "spec")?.streak, 0);
      }),
  );

  it.effect(
    "never approves ending a Grill or accepting Findings, even with Autonomy at both earnable boundaries",
    () =>
      Effect.gen(function* () {
        const root = project();
        const client = yield* makeClient;
        let last = "";
        for (let i = 0; i < 5; i++) {
          last = yield* cleanSpecPass(root);
          yield* approveAt(last, "implement");
          yield* approveAt(last, "retro");
        }
        const offered = yield* autonomyOf(last, (a) =>
          a.boundaries.every((b) => b.offer !== undefined),
        );
        // Only the end of Spec and the end of Implement are earnable.
        assert.deepStrictEqual(
          offered.boundaries.map((b) => b.boundary),
          ["spec", "implement"],
        );
        for (const b of offered.boundaries)
          yield* client.autonomy.accept({ params: { id: b.offer?.id ?? "" } });
        yield* autonomyOf(last, (a) => a.boundaries.every((b) => b.granted));

        retroFindings = [
          {
            title: "Lint before each commit",
            change: "Add a pre-commit hook running oxlint",
            reasoning: "Two Redirects were about lint errors.",
          },
        ];
        const id = yield* startSession(root);
        // The Grill still waits on the developer.
        yield* approveAt(id, "grill");
        // Spec and Implement go by on their own, and Retro waits on the developer.
        yield* turnWhere(id, (t) => t.text === "/retro");
        const retro = yield* checkpointAt(id, "retro");
        const mine = yield* autonomyOf(id, (a) =>
          a.boundaries.every((b) => b.approvedByFern),
        );
        assert.isTrue(mine.boundaries.every((b) => b.granted));
        // Its Findings wait for a verdict each; approving the Checkpoint is refused.
        const live = yield* makeLive;
        const flow = yield* firstWhere(
          live.Flow({ session: id }),
          (f) => f?.checkpoint?.id === retro,
        );
        assert.strictEqual(flow?.checkpoint?.findings?.length, 1);
        const refused = yield* client.flows
          .approve({ params: { id: retro } })
          .pipe(Effect.flip);
        assert.strictEqual(refused._tag, "FindingsUndecided");
      }).pipe(restoring),
  );

  it.effect(
    "checks Spec's exit criteria before Autonomy approves the end of Spec: a failed check passes nothing",
    () =>
      Effect.gen(function* () {
        const root = project();
        const client = yield* makeClient;
        let last = "";
        for (let i = 0; i < 5; i++) last = yield* cleanSpecPass(root);
        const offered = yield* autonomyOf(
          last,
          (a) => at(a, "spec")?.offer !== undefined,
        );
        yield* client.autonomy.accept({
          params: { id: at(offered, "spec")?.offer?.id ?? "" },
        });
        yield* autonomyOf(last, (a) => at(a, "spec")?.granted === true);

        specReport = { brief: 99, tickets: [3] };
        const id = yield* startSession(root);
        yield* approveAt(id, "grill");
        const failed = yield* Effect.suspend(() =>
          // Its second answer: the first is to the Grill's report.
          Effect.fromNullishOr(answers.filter((a) => a.sessionId === id)[1]),
        ).pipe(
          Effect.retry({ schedule: Schedule.spaced("5 millis"), times: 400 }),
          Effect.orDie,
        );
        assert.isTrue(failed.isError);
        assert.match(failed.text, /Brief #99/);
        const live = yield* makeLive;
        const waiting = yield* firstWhere(live.Flow({ session: id }), Boolean);
        assert.strictEqual(waiting?.phases[1]?.status, "current");
        assert.isUndefined(waiting?.checkpoint);
        assert.isFalse(
          started.some(
            (t) => t.sessionId === id && t.text.startsWith("/implement-spec"),
          ),
        );
        const before = yield* autonomyOf(id);
        assert.isFalse(at(before, "spec")?.approvedByFern);

        // Reported again with issues the tracker has, Fern approves it and starts Implement on
        // the Brief.
        const options = started.find((t) => t.sessionId === id)?.options ?? {};
        const passed = yield* Effect.promise(() =>
          call(options, "phase_done", {
            phase: "spec",
            summary: "spec done.",
            spec: GOOD_SPEC,
          }),
        );
        assert.isFalse(passed.isError);
        assert.match(passed.text, /Fern approved/);
        yield* turnWhere(id, (t) => t.text === "/implement-spec #2");
        yield* autonomyOf(id, (a) => at(a, "spec")?.approvedByFern === true);
      }).pipe(restoring),
  );

  it.effect(
    "doesn't count a skipped Phase toward a streak, nor start it over",
    () =>
      Effect.gen(function* () {
        const root = project();
        const client = yield* makeClient;
        yield* cleanSpecPass(root);
        const first = yield* cleanSpecPass(root);
        yield* approveAt(first, "implement");
        yield* autonomyOf(first, (a) => at(a, "implement")?.streak === 1);

        // A Session that skips Spec and Implement instead of reporting them done.
        silent = new Set(["spec", "implement"]);
        const id = yield* startSession(root);
        yield* approveAt(id, "grill");
        yield* turnWhere(id, (t) => t.text === "/to-tickets");
        yield* client.flows.skip({
          params: { session: id },
          payload: { phase: "spec", reason: "Tickets already exist" },
        });
        yield* turnWhere(id, (t) => t.text === "/implement-spec");
        yield* client.flows.skip({
          params: { session: id },
          payload: { phase: "implement", reason: "Done by hand" },
        });
        yield* turnWhere(id, (t) => t.text === "/retro");
        const live = yield* makeLive;
        const flow = yield* firstWhere(
          live.Flow({ session: id }),
          (f) => f?.phases[2]?.status === "skipped",
        );
        assert.deepStrictEqual(
          flow?.phases.map((p) => `${p.phase}:${p.status}`),
          ["grill:done", "spec:skipped", "implement:skipped", "retro:current"],
        );
        const skipped = yield* autonomyOf(id);
        assert.deepStrictEqual(streaks(skipped), ["spec:2/5", "implement:1/5"]);
        assert.isFalse(skipped.boundaries.some((b) => b.approvedByFern));

        // The next clean pass carries on the streak.
        silent = new Set();
        const next = yield* cleanSpecPass(root);
        const after = yield* autonomyOf(
          next,
          (a) => at(a, "spec")?.streak === 3,
        );
        assert.deepStrictEqual(streaks(after), ["spec:3/5", "implement:1/5"]);
      }).pipe(restoring),
  );
});
