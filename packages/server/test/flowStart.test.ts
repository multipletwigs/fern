import { assert, describe, it as test, layer } from "@effect/vitest";
import { FernApi, type FlowStart, LiveRpcs } from "@repo/api";
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
import { grillTopic, raised, suggestionIn } from "../src/flow/grill";
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

type CallTool = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ text: string; isError: boolean }>;

interface StartedTurn {
  readonly sessionId: string;
  readonly text: string;
  readonly options: Record<string, unknown>;
}
const started: Array<StartedTurn> = [];
// What the fake agent does in each turn before it ends; tests set it.
let agent: (turn: StartedTurn, call: CallTool) => Promise<void> = () =>
  Promise.resolve();
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

const serversOf = (options: Record<string, unknown>) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  options.mcpServers as Record<string, ToolServer>;

// The Fern tools a turn was opened with.
const toolsOf = (turn: StartedTurn) =>
  // oxlint-disable-next-line no-underscore-dangle
  Object.keys(serversOf(turn.options).fern?.instance._registeredTools ?? {});

const promptOf = (turn: StartedTurn) =>
  JSON.stringify(turn.options.systemPrompt);

const callerFor =
  (options: Record<string, unknown>): CallTool =>
  async (name, args) => {
    // oxlint-disable-next-line no-underscore-dangle
    const tool = serversOf(options).fern?.instance._registeredTools[name];
    if (!tool) throw new Error(`No Fern tool ${name}`);
    const result = await tool.handler(args, {});
    const answer = {
      text: result.content.map((c) => c.text).join("\n"),
      isError: result.isError === true,
    };
    answers.push(answer);
    return answer;
  };

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

const turnsOn = (sessionId: string) =>
  started.filter((t) => t.sessionId === sessionId);

// Waits for the Session's `n`th turn, counting from 1.
const nthTurn = (sessionId: string, n: number) =>
  Effect.suspend(() => Effect.fromNullishOr(turnsOn(sessionId)[n - 1])).pipe(
    Effect.retry({ schedule: Schedule.spaced("5 millis"), times: 400 }),
    Effect.orDie,
  );

// Waits until the Session's turn has ended, so another can start.
const idle = (sessionId: string) =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    yield* client.sessions.running().pipe(
      Effect.flatMap((running) =>
        running.includes(sessionId) ? Effect.fail("busy") : Effect.void,
      ),
      Effect.retry({ schedule: Schedule.spaced("5 millis"), times: 400 }),
      Effect.orDie,
    );
  });

const startChat = (text: string) =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    const { id } = yield* client.sessions.start({
      payload: { root: repo, message: { text } },
    });
    yield* nthTurn(id, 1);
    yield* idle(id);
    return id;
  });

const flowStartOf = (sessionId: string, holds: (s: FlowStart) => boolean) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    return yield* firstWhere(
      live.FlowStart({ session: sessionId }),
      (s) => s !== null && holds(s),
    );
  });

// In a chat, the agent suggests a Grill when the developer asks about dark mode.
const suggestsDarkMode: typeof agent = async (turn, call) => {
  if (turn.text.includes("dark mode"))
    await call("suggest_grill", { what: "Add a dark mode toggle" });
};

layer(
  Layer.mergeAll(
    handlersWith(NoWriter, FakeIssues).pipe(
      Layer.provide([
        DatabaseLive(":memory:"),
        Layer.succeed(WorktreesDir, { dir: dataDir }),
      ]),
    ),
    HttpServer.layerServices,
  ),
  { excludeTestServices: true },
)("A Session starts as a chat", (it) => {
  it.effect(
    "sends the opening message as typed, with the chat's steering and suggest_grill, and no Flow",
    () =>
      Effect.gen(function* () {
        agent = () => Promise.resolve();
        const id = yield* startChat("How does the review tab work?");
        const turn = yield* nthTurn(id, 1);

        assert.strictEqual(turn.text, "How does the review tab work?");
        assert.deepStrictEqual(toolsOf(turn), ["suggest_grill"]);
        assert.match(promptOf(turn), /starts as a chat/);
        assert.notMatch(promptOf(turn), /phase_done/);
        const live = yield* makeLive;
        assert.isNull(
          yield* firstWhere(live.Flow({ session: id }), () => true),
        );
        const state = yield* flowStartOf(id, () => true);
        assert.isFalse(state?.started);
        assert.deepStrictEqual(state?.suggestions, []);
        const phases = yield* firstWhere(live.SessionPhases(), () => true);
        assert.isFalse(phases?.some((p) => p.sessionId === id));
      }),
  );

  it.effect(
    "starting the Grill from a suggestion sends it, as edited, into the same Session, renames the branch and opens Claude Code again with the Flow's tools",
    () =>
      Effect.gen(function* () {
        agent = suggestsDarkMode;
        const id = yield* startChat("Could we have dark mode?");
        const shown = yield* flowStartOf(id, (s) => s.suggestions.length > 0);
        const suggestion = shown?.suggestions[0];
        assert.strictEqual(suggestion?.what, "Add a dark mode toggle");
        assert.strictEqual(suggestion?.status, "pending");
        const cwd = String((yield* nthTurn(id, 1)).options.cwd);

        const client = yield* makeClient;
        yield* client.flows.grill({
          params: { session: id },
          payload: {
            what: "Add a dark mode toggle to settings",
            suggestion: suggestion?.id,
          },
        });
        const grill = yield* nthTurn(id, 2);

        assert.strictEqual(
          grill.text,
          "/grill-with-docs Add a dark mode toggle to settings",
        );
        assert.strictEqual(grill.options.resume, id);
        assert.includeMembers(toolsOf(grill), ["phase_done", "post_round"]);
        assert.notInclude(toolsOf(grill), "suggest_grill");
        assert.match(promptOf(grill), /follows Fern's Flow/);
        assert.match(
          git(cwd, "branch", "--show-current"),
          /^add-a-dark-mode-toggle-to-settings-[0-9a-f]{6}$/,
        );
        const after = yield* flowStartOf(id, (s) => s.started);
        assert.strictEqual(after?.suggestions[0]?.status, "started");
        const live = yield* makeLive;
        const flow = yield* firstWhere(
          live.Flow({ session: id }),
          (f) => f !== null,
        );
        assert.strictEqual(
          flow?.phases.find((p) => p.status === "current")?.phase,
          "grill",
        );

        yield* idle(id);
        const again = yield* client.flows
          .grill({ params: { session: id }, payload: { what: "Again" } })
          .pipe(Effect.flip);
        assert.strictEqual(again._tag, "FlowStarted");
      }),
  );

  it.effect("keeps one suggestion waiting on the developer at a time", () =>
    Effect.gen(function* () {
      answers.length = 0;
      agent = async (turn, call) => {
        await call("suggest_grill", { what: "Add a dark mode toggle" });
        await call("suggest_grill", { what: "Add a light mode toggle" });
      };
      const id = yield* startChat("Could we have dark mode?");
      const state = yield* flowStartOf(id, (s) => s.suggestions.length > 0);

      assert.deepStrictEqual(
        state?.suggestions.map((s) => s.what),
        ["Add a dark mode toggle"],
      );
      assert.isFalse(answers[0]?.isError);
      assert.isTrue(answers[1]?.isError);
      assert.match(answers[1]?.text ?? "", /already waits/);
    }),
  );

  it.effect(
    "Not now closes the suggestion, and Claude hears of it once, with the developer's next message",
    () =>
      Effect.gen(function* () {
        agent = suggestsDarkMode;
        const id = yield* startChat("Could we have dark mode?");
        const state = yield* flowStartOf(id, (s) => s.suggestions.length > 0);
        const suggestion = state?.suggestions[0]?.id ?? "";
        const client = yield* makeClient;
        yield* client.flows.dismiss({ params: { id: suggestion } });
        const closed = yield* client.flows
          .dismiss({ params: { id: suggestion } })
          .pipe(Effect.flip);
        assert.strictEqual(closed._tag, "GrillSuggestionClosed");

        agent = () => Promise.resolve();
        yield* client.sessions.send({
          params: { id },
          payload: { text: "What else is there?" },
        });
        const told = yield* nthTurn(id, 2);
        yield* idle(id);
        yield* client.sessions.send({
          params: { id },
          payload: { text: "And after that?" },
        });
        const next = yield* nthTurn(id, 3);

        assert.match(told.text, /^What else is there\?\n\n<system-reminder>/);
        assert.match(
          told.text,
          /turned down the Grill for "Add a dark mode toggle"/,
        );
        assert.strictEqual(next.text, "And after that?");
        const after = yield* flowStartOf(
          id,
          (s) => s.suggestions[0]?.status === "dismissed",
        );
        assert.isFalse(after?.started);
      }),
  );

  it.effect("the Grill's command typed into a chat starts its Flow", () =>
    Effect.gen(function* () {
      agent = () => Promise.resolve();
      const id = yield* startChat("Look around the settings page");
      const client = yield* makeClient;
      yield* client.sessions.send({
        params: { id },
        payload: { text: "/grill-with-docs Split the settings page" },
      });
      const grill = yield* nthTurn(id, 2);

      assert.strictEqual(
        grill.text,
        "/grill-with-docs Split the settings page",
      );
      assert.includeMembers(toolsOf(grill), ["phase_done", "post_round"]);
      const state = yield* flowStartOf(id, (s) => s.started);
      assert.isTrue(state?.started);
    }),
  );

  it.effect(
    "an opening message that's the Grill's command starts the Flow with it",
    () =>
      Effect.gen(function* () {
        agent = () => Promise.resolve();
        const id = yield* startChat("/grill-with-docs Add a dark mode toggle");
        const turn = yield* nthTurn(id, 1);

        assert.includeMembers(toolsOf(turn), ["phase_done", "post_round"]);
        const cwd = String(turn.options.cwd);
        assert.match(
          git(cwd, "branch", "--show-current"),
          /^add-a-dark-mode-toggle-[0-9a-f]{6}$/,
        );
        const state = yield* flowStartOf(id, () => true);
        assert.isTrue(state?.started);
      }),
  );
});

describe("The Grill's command and suggestions", () => {
  test("reads what a Grill command starts on, and nothing from other messages", () => {
    assert.strictEqual(grillTopic("/grill-with-docs  Add it "), "Add it");
    assert.strictEqual(grillTopic("/grill-with-docs"), "");
    assert.isUndefined(grillTopic("/grill-with-docsy now"));
    assert.isUndefined(grillTopic("grill this"));
  });

  test("finds the suggestion a suggest_grill answer names", () => {
    const id = crypto.randomUUID();
    assert.strictEqual(suggestionIn(raised(id)), id);
    assert.isUndefined(suggestionIn("Something else."));
  });
});
