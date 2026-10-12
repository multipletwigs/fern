import { assert, it as test, layer } from "@effect/vitest";
import { FernApi, type Flow, LiveRpcs } from "@repo/api";
import { Effect, Fiber, Layer, Schedule, Stream } from "effect";
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

// A Project: a repo on `main` with one commit, where the developer has run a Session.
const repo = realpathSync(mkdtempSync(join(tmpdir(), "fern-repo-")));
git(repo, "init", "-q", "-b", "main");
writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
git(repo, "add", "-A");
git(repo, "commit", "-q", "-m", "Initial");
transcript(repo, crypto.randomUUID(), "Earlier work", "cli");

// A Fern tool as the agent sees it: called by name with its input, answering with text.
type CallTool = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ text: string; isError: boolean }>;

// One turn Claude Code is asked to run: on which Session, and its first message.
interface StartedTurn {
  readonly sessionId: string;
  readonly text: string;
  readonly options: Record<string, unknown>;
}
const started: Array<StartedTurn> = [];
// What the fake agent does in each turn before it ends; tests set it.
let agent: (turn: StartedTurn, call: CallTool) => Promise<void> = () =>
  Promise.resolve();
// What Fern's tools answered the agent.
const answers: Array<{ text: string; isError: boolean }> = [];

interface ToolServer {
  readonly instance: {
    readonly _registeredTools: Record<
      string,
      {
        readonly handler: (
          args: Record<string, unknown>,
          extra: unknown,
        ) => Promise<{
          content: Array<{ text: string }>;
          isError?: boolean;
        }>;
      }
    >;
  };
}

// Calls a tool the way Claude Code would: through the in-process MCP server Fern passed.
const callerFor =
  (options: Record<string, unknown>): CallTool =>
  async (name, args) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const servers = options.mcpServers as Record<string, ToolServer>;
    // oxlint-disable-next-line no-underscore-dangle
    const tool = servers.fern?.instance._registeredTools[name];
    if (!tool) throw new Error(`No Fern tool ${name}`);
    const result = await tool.handler(args, {});
    const answer = {
      text: result.content.map((c) => c.text).join("\n"),
      isError: result.isError === true,
    };
    answers.push(answer);
    return answer;
  };

// Only the Agent SDK's query() is faked: it records the turn, writes the transcript as Claude Code
// would, lets the fake agent act, then ends the turn.
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const { scriptedQuery } = await import("./fakeClaude");
  return {
    ...(await importOriginal<object>()),
    query: scriptedQuery(async ({ sessionId, text, options, first }) => {
      const turn = { sessionId, text, options };
      started.push(turn);
      if (first && typeof options.sessionId === "string")
        transcript(String(options.cwd), options.sessionId, text);
      await agent(turn, callerFor(options));
    }),
  };
});

const makeClient = HttpApiTest.groups(FernApi, ["sessions", "flows"]);
const makeLive = RpcTest.makeClient(LiveRpcs);

// Fern's API on a database file, as the app runs it.
const server = (database: string) =>
  Layer.mergeAll(
    handlersWith(NoWriter, FakeIssues).pipe(
      Layer.provide([
        DatabaseLive(database),
        Layer.succeed(WorktreesDir, { dir: dataDir }),
      ]),
    ),
    HttpServer.layerServices,
  );
// Runs the effect against its own server on the database, shut down after: one run of Fern.
const runOn =
  (database: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const context = yield* Layer.build(server(database));
      return yield* effect.pipe(Effect.provideContext(context));
    }).pipe(Effect.scoped);
const freshDatabase = () =>
  join(mkdtempSync(join(tmpdir(), "fern-db-")), "fern.db");

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
  );

// Waits until Claude Code has been asked to run a turn on the Session that satisfies the predicate.
const turnWhere = (
  sessionId: string,
  predicate: (turn: StartedTurn) => boolean = () => true,
) =>
  Effect.suspend(() =>
    Effect.fromNullishOr(
      started.find((t) => t.sessionId === sessionId && predicate(t)),
    ),
  ).pipe(
    Effect.retry({ schedule: Schedule.spaced("5 millis"), times: 400 }),
    Effect.orDie,
  );

const startSession = (text: string) =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    const { id } = yield* client.sessions.start({
      payload: { root: repo, message: { text } },
    });
    yield* turnWhere(id);
    return id;
  });

// The latest value of a live stream, kept as it changes.
const watch = <A, E>(stream: Stream.Stream<A, E>) =>
  Effect.gen(function* () {
    let latest: A | undefined;
    const fiber = yield* stream.pipe(
      Stream.runForEach((a) => Effect.sync(() => (latest = a))),
      Effect.forkChild,
    );
    yield* Effect.suspend(() => Effect.fromNullishOr(latest)).pipe(
      Effect.retry({ schedule: Schedule.spaced("5 millis") }),
    );
    return { latest: () => latest, fiber };
  });

// Waits for the predicate to hold within a second, well before any two-second poll.
const soon = (holds: () => boolean) =>
  Effect.suspend(() => (holds() ? Effect.void : Effect.fail("not yet"))).pipe(
    Effect.retry({ schedule: Schedule.spaced("10 millis") }),
    Effect.timeout("1 second"),
  );

const statuses = (flow: Flow | null | undefined) =>
  flow?.phases.map((p) => `${p.phase}:${p.status}`);

// The agent ends the Grill: it reports the Phase done through Fern's tool in the Grill's turn.
const reportsGrillDone: typeof agent = async (turn, call) => {
  if (turn.text.startsWith("/grill-with-docs"))
    await call("phase_done", {
      phase: "grill",
      summary: "We agreed on a toggle in the settings page.",
    });
};

// Starts a Session whose agent reports the Grill done, and waits for its Checkpoint.
const atGrillCheckpoint = Effect.gen(function* () {
  agent = reportsGrillDone;
  const id = yield* startSession("Add a dark mode toggle");
  const live = yield* makeLive;
  const flow = yield* firstWhere(
    live.Flow({ session: id }),
    (f) => f?.checkpoint !== undefined,
  );
  return { id, checkpoint: flow?.checkpoint?.id ?? "" };
});

// Starts a Session and takes it through the Grill, so Spec is current.
const atSpec = Effect.gen(function* () {
  const session = yield* atGrillCheckpoint;
  const client = yield* makeClient;
  yield* client.flows.approve({ params: { id: session.checkpoint } });
  yield* turnWhere(session.id, (t) => t.text === "/to-tickets");
  const call = callerFor(
    started.find((t) => t.sessionId === session.id)?.options ?? {},
  );
  return { id: session.id, call };
});

layer(server(freshDatabase()), { excludeTestServices: true })("Flows", (it) => {
  it.effect("starts a new Hosted Session's Flow with Grill current", () =>
    Effect.gen(function* () {
      agent = () => Promise.resolve();
      const id = yield* startSession("Add a dark mode toggle");
      const live = yield* makeLive;
      const flow = yield* firstWhere(live.Flow({ session: id }), Boolean);

      assert.deepStrictEqual(statuses(flow), [
        "grill:current",
        "spec:notStarted",
        "implement:notStarted",
        "retro:notStarted",
      ]);
      assert.isUndefined(flow?.checkpoint);
    }),
  );

  it.effect(
    "raises a Checkpoint on the Flow and in the shared queue when the agent reports its Phase done",
    () =>
      Effect.gen(function* () {
        answers.length = 0;
        agent = reportsGrillDone;
        const id = yield* startSession("Add a dark mode toggle");
        const live = yield* makeLive;
        const flow = yield* firstWhere(
          live.Flow({ session: id }),
          (f) => f?.checkpoint !== undefined,
        );

        assert.strictEqual(flow?.checkpoint?.phase, "grill");
        assert.strictEqual(flow?.checkpoint?.status, "pending");
        assert.strictEqual(
          flow?.checkpoint?.summary,
          "We agreed on a toggle in the settings page.",
        );
        assert.strictEqual(statuses(flow)?.[0], "grill:current");
        // The tool answered at once, telling the agent to end its turn.
        assert.isFalse(answers[0]?.isError);
        assert.match(answers[0]?.text ?? "", /end your turn/i);

        const queue = yield* firstWhere(live.Checkpoints(), (all) =>
          all.some((c) => c.sessionId === id),
        );
        assert.deepStrictEqual(
          queue?.map((c) => [c.sessionId, c.phase]),
          [[id, "grill"]],
        );
        const phases = yield* firstWhere(live.SessionPhases(), (all) =>
          all.some((p) => p.sessionId === id),
        );
        assert.strictEqual(
          phases?.find((p) => p.sessionId === id)?.current,
          "grill",
        );
      }),
  );

  it.effect(
    "gives a Hosted Session's turns the Phase-done tool, allowed to run, and the steering",
    () =>
      Effect.gen(function* () {
        agent = () => Promise.resolve();
        const id = yield* startSession("Add a dark mode toggle");
        const turn = yield* turnWhere(id);

        // Other services' tools (the Round tool) share the one `fern` server.
        assert.include(turn.options.allowedTools, "mcp__fern__phase_done");
        const append = JSON.stringify(turn.options.systemPrompt);
        assert.match(append, /phase_done/);
        assert.match(append, /Never start the next Phase's skill yourself/);
      }),
  );

  it.effect(
    "answers a report for a Phase that isn't current with what's current, and raises nothing",
    () =>
      Effect.gen(function* () {
        answers.length = 0;
        agent = async (turn, call) => {
          if (turn.text.startsWith("/grill-with-docs"))
            await call("phase_done", { phase: "spec", summary: "Done." });
        };
        const id = yield* startSession("Add a dark mode toggle");
        yield* Effect.suspend(() =>
          answers.length > 0 ? Effect.void : Effect.fail("waiting"),
        ).pipe(
          Effect.retry({ schedule: Schedule.spaced("5 millis"), times: 400 }),
          Effect.orDie,
        );

        assert.isTrue(answers[0]?.isError);
        assert.match(answers[0]?.text ?? "", /current Phase is Grill/);
        const live = yield* makeLive;
        const flow = yield* firstWhere(live.Flow({ session: id }), Boolean);
        assert.isUndefined(flow?.checkpoint);
      }),
  );

  it.effect(
    "on approval, marks the Phase done, makes the next current and sends its commands in order",
    () =>
      Effect.gen(function* () {
        const { id, checkpoint } = yield* atGrillCheckpoint;
        const client = yield* makeClient;
        yield* client.flows.approve({ params: { id: checkpoint } });

        const live = yield* makeLive;
        const flow = yield* firstWhere(
          live.Flow({ session: id }),
          (f) => f?.checkpoint === undefined,
        );
        assert.deepStrictEqual(statuses(flow), [
          "grill:done",
          "spec:current",
          "implement:notStarted",
          "retro:notStarted",
        ]);
        yield* turnWhere(id, (t) => t.text === "/to-tickets");
        assert.deepStrictEqual(
          started.filter((t) => t.sessionId === id).map((t) => t.text),
          [
            "/grill-with-docs Add a dark mode toggle",
            "/to-spec",
            "/to-tickets",
          ],
        );
        const queue = yield* firstWhere(live.Checkpoints(), () => true);
        assert.isFalse(queue?.some((c) => c.sessionId === id));
        const phases = yield* firstWhere(live.SessionPhases(), (all) =>
          all.some((p) => p.sessionId === id),
        );
        assert.strictEqual(
          phases?.find((p) => p.sessionId === id)?.current,
          "spec",
        );

        // Decided once: approving again is refused.
        const again = yield* client.flows
          .approve({ params: { id: checkpoint } })
          .pipe(Effect.flip);
        assert.strictEqual(again._tag, "CheckpointClosed");
      }),
  );

  it.effect(
    "on decline, sends the note as a Redirect and keeps the Phase current",
    () =>
      Effect.gen(function* () {
        const { id, checkpoint } = yield* atGrillCheckpoint;
        const client = yield* makeClient;
        yield* client.flows.decline({
          params: { id: checkpoint },
          payload: { note: "We haven't settled where the toggle lives." },
        });

        const redirect = yield* turnWhere(id, (t) =>
          t.text.includes("We haven't settled where the toggle lives."),
        );
        assert.match(redirect.text, /declined/);
        const live = yield* makeLive;
        const flow = yield* firstWhere(
          live.Flow({ session: id }),
          (f) => f?.checkpoint === undefined,
        );
        assert.strictEqual(statuses(flow)?.[0], "grill:current");
        assert.strictEqual(statuses(flow)?.[1], "spec:notStarted");
        const queue = yield* firstWhere(live.Checkpoints(), () => true);
        assert.isFalse(queue?.some((c) => c.sessionId === id));
      }),
  );

  it.effect(
    "on a Skip, marks the Phase skipped with its reason, makes the next current and sends its commands",
    () =>
      Effect.gen(function* () {
        agent = () => Promise.resolve();
        const id = yield* startSession("Fix the typo in the README");
        const client = yield* makeClient;
        yield* client.flows.skip({
          params: { session: id },
          payload: { phase: "grill", reason: "Just a typo fix" },
        });

        const live = yield* makeLive;
        const flow = yield* firstWhere(
          live.Flow({ session: id }),
          (f) => f?.phases[0]?.status === "skipped",
        );
        assert.deepStrictEqual(statuses(flow), [
          "grill:skipped",
          "spec:current",
          "implement:notStarted",
          "retro:notStarted",
        ]);
        assert.strictEqual(flow?.phases[0]?.reason, "Just a typo fix");
        yield* turnWhere(id, (t) => t.text === "/to-tickets");
        assert.deepStrictEqual(
          started.filter((t) => t.sessionId === id).map((t) => t.text),
          [
            "/grill-with-docs Fix the typo in the README",
            "/to-spec",
            "/to-tickets",
          ],
        );
      }),
  );

  it.effect("refuses a Skip without a reason", () =>
    Effect.gen(function* () {
      agent = () => Promise.resolve();
      const id = yield* startSession("Fix the typo in the README");
      const client = yield* makeClient;
      for (const reason of ["", "   "])
        yield* client.flows
          .skip({
            params: { session: id },
            payload: { phase: "grill", reason },
          })
          .pipe(Effect.flip);

      const live = yield* makeLive;
      const flow = yield* firstWhere(live.Flow({ session: id }), Boolean);
      assert.strictEqual(statuses(flow)?.[0], "grill:current");
      assert.deepStrictEqual(
        started.filter((t) => t.sessionId === id).map((t) => t.text),
        ["/grill-with-docs Fix the typo in the README"],
      );
    }),
  );

  it.effect(
    "refuses to skip a Phase that's done or not yet current, or one waiting at a Checkpoint",
    () =>
      Effect.gen(function* () {
        const { id, checkpoint } = yield* atGrillCheckpoint;
        const client = yield* makeClient;
        const skip = (phase: "grill" | "spec" | "implement") =>
          client.flows
            .skip({
              params: { session: id },
              payload: { phase, reason: "Not needed" },
            })
            .pipe(Effect.flip);

        const waiting = yield* skip("grill");
        assert.deepStrictEqual(
          waiting._tag === "PhaseNotSkippable" ? waiting.why : waiting._tag,
          "checkpointPending",
        );
        const notYet = yield* skip("spec");
        assert.deepStrictEqual(
          notYet._tag === "PhaseNotSkippable" ? notYet.why : notYet._tag,
          "notCurrent",
        );

        yield* client.flows.approve({ params: { id: checkpoint } });
        yield* turnWhere(id, (t) => t.text === "/to-tickets");
        const done = yield* skip("grill");
        assert.deepStrictEqual(
          done._tag === "PhaseNotSkippable" ? done.why : done._tag,
          "notCurrent",
        );
        const later = yield* skip("implement");
        assert.deepStrictEqual(
          later._tag === "PhaseNotSkippable" ? later.why : later._tag,
          "notCurrent",
        );

        const live = yield* makeLive;
        const flow = yield* firstWhere(live.Flow({ session: id }), Boolean);
        assert.deepStrictEqual(statuses(flow), [
          "grill:done",
          "spec:current",
          "implement:notStarted",
          "retro:notStarted",
        ]);
      }),
  );

  it.effect(
    "takes an archived Session's pending Checkpoint out of the queue",
    () =>
      Effect.gen(function* () {
        const { id } = yield* atGrillCheckpoint;
        const live = yield* makeLive;
        yield* firstWhere(live.Checkpoints(), (all) =>
          all.some((c) => c.sessionId === id),
        );

        const client = yield* makeClient;
        yield* client.sessions.archive({
          params: { id },
          payload: { force: true },
        });

        const queue = yield* firstWhere(
          live.Checkpoints(),
          (all) => !all.some((c) => c.sessionId === id),
        );
        assert.isFalse(queue?.some((c) => c.sessionId === id));
        const flow = yield* firstWhere(live.Flow({ session: id }), Boolean);
        assert.isUndefined(flow?.checkpoint);
      }),
  );
  it.effect(
    "shows a Session started meanwhile in the Phases, and an archived Session's Checkpoint leaving the queue, at once",
    () =>
      Effect.gen(function* () {
        const live = yield* makeLive;
        agent = () => Promise.resolve();
        const phases = yield* watch(live.SessionPhases());
        const id = yield* startSession("Show me at once");
        yield* soon(
          () => phases.latest()?.some((p) => p.sessionId === id) === true,
        );
        yield* Fiber.interrupt(phases.fiber);

        const waiting = yield* atGrillCheckpoint;
        const queue = yield* watch(live.Checkpoints());
        yield* soon(
          () =>
            queue.latest()?.some((c) => c.sessionId === waiting.id) === true,
        );
        const client = yield* makeClient;
        yield* client.sessions.archive({
          params: { id: waiting.id },
          payload: { force: true },
        });
        yield* soon(
          () =>
            queue.latest()?.some((c) => c.sessionId === waiting.id) === false,
        );
        yield* Fiber.interrupt(queue.fiber);
      }),
  );

  it.effect("refuses to approve, decline or skip at an archived Session", () =>
    Effect.gen(function* () {
      const { id, checkpoint } = yield* atGrillCheckpoint;
      const client = yield* makeClient;
      yield* client.sessions.archive({
        params: { id },
        payload: { force: true },
      });
      const turns = started.length;

      const approved = yield* client.flows
        .approve({ params: { id: checkpoint } })
        .pipe(Effect.flip);
      const declined = yield* client.flows
        .decline({ params: { id: checkpoint }, payload: { note: "No." } })
        .pipe(Effect.flip);
      const skipped = yield* client.flows
        .skip({
          params: { session: id },
          payload: { phase: "grill", reason: "Not needed" },
        })
        .pipe(Effect.flip);

      assert.deepStrictEqual(
        [approved._tag, declined._tag, skipped._tag],
        ["SessionArchived", "SessionArchived", "SessionArchived"],
      );
      assert.strictEqual(started.length, turns);
    }),
  );

  it.effect(
    "answers a Spec-done report naming issues the tracker doesn't have with what's missing, and raises nothing",
    () =>
      Effect.gen(function* () {
        const { id, call } = yield* atSpec;
        const missing = yield* Effect.promise(() =>
          call("phase_done", {
            phase: "spec",
            summary: "Brief and tickets written.",
            spec: { brief: 99, tickets: [3, 98] },
          }),
        );
        assert.isTrue(missing.isError);
        assert.match(missing.text, /Brief #99/);
        assert.match(missing.text, /ticket #98/);
        assert.notMatch(missing.text, /#3\b/);

        const unnamed = yield* Effect.promise(() =>
          call("phase_done", { phase: "spec", summary: "Brief written." }),
        );
        assert.isTrue(unnamed.isError);
        assert.match(unnamed.text, /Brief/);

        const live = yield* makeLive;
        const flow = yield* firstWhere(live.Flow({ session: id }), Boolean);
        assert.isUndefined(flow?.checkpoint);
        assert.strictEqual(statuses(flow)?.[1], "spec:current");
      }),
  );

  it.effect(
    "raises the Spec Checkpoint with the Brief and its tickets from the issue tracker",
    () =>
      Effect.gen(function* () {
        const { id, call } = yield* atSpec;
        const answer = yield* Effect.promise(() =>
          call("phase_done", {
            phase: "spec",
            summary: "Brief and tickets written.",
            spec: { brief: 2, tickets: [3, 4] },
          }),
        );
        assert.isFalse(answer.isError);

        const live = yield* makeLive;
        const flow = yield* firstWhere(
          live.Flow({ session: id }),
          (f) => f?.checkpoint !== undefined,
        );
        assert.strictEqual(flow?.checkpoint?.phase, "spec");
        assert.deepStrictEqual(flow?.checkpoint?.spec, {
          brief: {
            number: 2,
            title: "Dark mode",
            url: "https://github.com/acme/app/issues/2",
          },
          tickets: [
            {
              number: 3,
              title: "Add the theme setting",
              url: "https://github.com/acme/app/issues/3",
            },
            {
              number: 4,
              title: "Toggle in the settings page",
              url: "https://github.com/acme/app/issues/4",
            },
          ],
        });
      }),
  );

  it.effect("on approving Spec, sends /implement-spec with the Brief", () =>
    Effect.gen(function* () {
      const { id, call } = yield* atSpec;
      yield* Effect.promise(() =>
        call("phase_done", {
          phase: "spec",
          summary: "Brief and tickets written.",
          spec: { brief: 2, tickets: [3, 4] },
        }),
      );
      const live = yield* makeLive;
      const flow = yield* firstWhere(
        live.Flow({ session: id }),
        (f) => f?.checkpoint !== undefined,
      );
      const client = yield* makeClient;
      yield* client.flows.approve({
        params: { id: flow?.checkpoint?.id ?? "" },
      });

      const implement = yield* turnWhere(id, (t) =>
        t.text.startsWith("/implement-spec"),
      );
      assert.strictEqual(implement.text, "/implement-spec #2");
    }),
  );
});

test.live("keeps the Flow and its pending Checkpoint after Fern restarts", () =>
  Effect.gen(function* () {
    const database = freshDatabase();
    const { id } = yield* Effect.gen(function* () {
      const session = yield* atGrillCheckpoint;
      const client = yield* makeClient;
      yield* client.flows.approve({ params: { id: session.checkpoint } });
      yield* turnWhere(session.id, (t) => t.text === "/to-tickets");
      // The agent then reports Spec done.
      const call = callerFor(
        started.find((t) => t.sessionId === session.id)?.options ?? {},
      );
      yield* Effect.promise(() =>
        call("phase_done", {
          phase: "spec",
          summary: "Brief #2 written.",
          spec: { brief: 2, tickets: [3, 4] },
        }),
      );
      return session;
    }).pipe(runOn(database));

    // A new server on the same database.
    const flow = yield* Effect.gen(function* () {
      const live = yield* makeLive;
      return yield* firstWhere(live.Flow({ session: id }), Boolean);
    }).pipe(runOn(database));
    assert.deepStrictEqual(statuses(flow), [
      "grill:done",
      "spec:current",
      "implement:notStarted",
      "retro:notStarted",
    ]);
    assert.strictEqual(flow?.checkpoint?.phase, "spec");
    assert.strictEqual(flow?.checkpoint?.status, "pending");
  }),
);
