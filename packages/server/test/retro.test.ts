import { assert, layer } from "@effect/vitest";
import { FernApi, type Flow, LiveRpcs } from "@repo/api";
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
      await agent(turn, callerFor(options));
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

const statuses = (flow: Flow | null | undefined) =>
  flow?.phases.map((p) => `${p.phase}:${p.status}`);

const FINDINGS = [
  {
    title: "Run the typecheck before claiming done",
    change: "Add `pnpm check-types` to the Checks in AGENTS.md.",
    reasoning: "The agent claimed done twice with type errors.",
  },
  {
    title: "Stop asking about formatting",
    change: "Add a hook that runs the formatter after every edit.",
    reasoning: "Three Redirects were about formatting.",
  },
];
type ReportedFinding = (typeof FINDINGS)[number];

// The agent works through the Flow: it reports each Phase done when its command arrives, and
// ends Retro with the Findings.
const worksThroughFlow =
  (findings: ReadonlyArray<ReportedFinding>): typeof agent =>
  async (turn, call) => {
    if (turn.text.startsWith("/grill-with-docs"))
      await call("phase_done", { phase: "grill", summary: "Agreed." });
    if (turn.text === "/to-tickets")
      await call("phase_done", {
        phase: "spec",
        summary: "Brief #2.",
        spec: { brief: 2, tickets: [3, 4] },
      });
    if (turn.text.startsWith("/implement-spec"))
      await call("phase_done", { phase: "implement", summary: "Built." });
    if (turn.text === "/retro")
      await call("phase_done", {
        phase: "retro",
        summary: "Two Findings about the Setup.",
        findings,
      });
  };

// Starts a Session, approves its Checkpoints up to Retro, and waits for the Retro Checkpoint.
const atRetro = (findings: ReadonlyArray<ReportedFinding>) =>
  Effect.gen(function* () {
    agent = worksThroughFlow(findings);
    const id = yield* startSession("Add a dark mode toggle");
    const client = yield* makeClient;
    const live = yield* makeLive;
    for (const phase of ["grill", "spec", "implement"]) {
      const flow = yield* firstWhere(
        live.Flow({ session: id }),
        (f) => f?.checkpoint?.phase === phase,
      );
      yield* client.flows.approve({
        params: { id: flow?.checkpoint?.id ?? "" },
      });
    }
    const flow = yield* firstWhere(
      live.Flow({ session: id }),
      (f) => f?.checkpoint?.phase === "retro",
    );
    return { id, checkpoint: flow?.checkpoint };
  });

const sentTo = (id: string) =>
  started.filter((t) => t.sessionId === id).map((t) => t.text);

layer(server(freshDatabase()), { excludeTestServices: true })(
  "Retro Findings",
  (it) => {
    it.effect(
      "shows the Findings from the Retro-done report on the Flow, none decided",
      () =>
        Effect.gen(function* () {
          const { checkpoint } = yield* atRetro(FINDINGS);

          assert.deepStrictEqual(
            checkpoint?.findings?.map((f) => [
              f.title,
              f.change,
              f.reasoning,
              f.verdict,
            ]),
            FINDINGS.map((f) => [f.title, f.change, f.reasoning, undefined]),
          );
        }),
    );

    it.effect(
      "keeps Retro current, with its Checkpoint, until every Finding has a verdict",
      () =>
        Effect.gen(function* () {
          const { id, checkpoint } = yield* atRetro(FINDINGS);
          const [first] = checkpoint?.findings ?? [];
          const client = yield* makeClient;
          yield* client.flows.findingVerdict({
            params: { id: first?.id ?? "" },
            payload: { kind: "accepted" },
          });

          const live = yield* makeLive;
          const flow = yield* firstWhere(
            live.Flow({ session: id }),
            (f) => f?.checkpoint?.findings?.[0]?.verdict !== undefined,
          );
          assert.deepStrictEqual(flow?.checkpoint?.findings?.[0]?.verdict, {
            kind: "accepted",
            note: undefined,
          });
          assert.isUndefined(flow?.checkpoint?.findings?.[1]?.verdict);
          assert.strictEqual(statuses(flow)?.[3], "retro:current");

          // Approving can't settle the Findings in their place.
          const approving = yield* client.flows
            .approve({ params: { id: checkpoint?.id ?? "" } })
            .pipe(Effect.flip);
          assert.strictEqual(approving._tag, "FindingsUndecided");
          assert.notInclude(sentTo(id).at(-1) ?? "", "Findings");
        }),
    );

    it.effect(
      "on the last verdict, marks Retro done and sends only the accepted Findings, in one message",
      () =>
        Effect.gen(function* () {
          const { id, checkpoint } = yield* atRetro(FINDINGS);
          const [accepted, declined] = checkpoint?.findings ?? [];
          const client = yield* makeClient;
          yield* client.flows.findingVerdict({
            params: { id: declined?.id ?? "" },
            payload: { kind: "declined", note: "We format in CI already." },
          });
          yield* client.flows.findingVerdict({
            params: { id: accepted?.id ?? "" },
            payload: { kind: "accepted" },
          });

          const live = yield* makeLive;
          const flow = yield* firstWhere(
            live.Flow({ session: id }),
            (f) => f?.checkpoint === undefined,
          );
          assert.deepStrictEqual(statuses(flow), [
            "grill:done",
            "spec:done",
            "implement:done",
            "retro:done",
          ]);
          const message = yield* turnWhere(id, (t) =>
            t.text.includes(FINDINGS[0]?.title ?? ""),
          );
          assert.include(message.text, FINDINGS[0]?.change ?? "");
          assert.match(message.text, /commit/i);
          assert.match(message.text, /separate from the feature/i);
          assert.notInclude(message.text, FINDINGS[1]?.title ?? "");
          assert.notInclude(message.text, "We format in CI already.");
          assert.strictEqual(
            sentTo(id).filter((t) => t.includes(FINDINGS[0]?.title ?? ""))
              .length,
            1,
          );
          const queue = yield* firstWhere(live.Checkpoints(), () => true);
          assert.isFalse(queue?.some((c) => c.sessionId === id));

          // Retro is over: its Findings can't change now.
          const again = yield* client.flows
            .findingVerdict({
              params: { id: declined?.id ?? "" },
              payload: { kind: "accepted" },
            })
            .pipe(Effect.flip);
          assert.strictEqual(again._tag, "CheckpointClosed");
        }),
    );

    it.effect(
      "marks Retro done without a message when every Finding is declined",
      () =>
        Effect.gen(function* () {
          const { id, checkpoint } = yield* atRetro(FINDINGS.slice(0, 1));
          const client = yield* makeClient;
          const before = sentTo(id).length;
          yield* client.flows.findingVerdict({
            params: { id: checkpoint?.findings?.[0]?.id ?? "" },
            payload: { kind: "declined" },
          });

          const live = yield* makeLive;
          const flow = yield* firstWhere(
            live.Flow({ session: id }),
            (f) => f?.checkpoint === undefined,
          );
          assert.strictEqual(statuses(flow)?.[3], "retro:done");
          assert.strictEqual(sentTo(id).length, before);
        }),
    );
  },
);
