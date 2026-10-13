import { assert, layer } from "@effect/vitest";
import { FernApi, LiveRpcs, type Walkthrough } from "@repo/api";
import { Deferred, Effect, Layer, Schedule, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { RpcTest } from "effect/rpc";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { vi } from "vitest";
import { CodeHost } from "../src/codehost/CodeHost";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import {
  WalkthroughWriter,
  type WriteRequest,
} from "../src/walkthrough/WalkthroughWriter";
import { WorktreesDir } from "../src/worktree/Worktrees";
import { FakeIssues } from "./stubs";

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

// A Project of its own: a repo on `main` with one commit, where the developer has run a Session,
// its `origin` on GitHub unless it's `offGitHub`.
const project = ({ offGitHub = false } = {}) => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "fern-repo-")));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Initial");
  if (!offGitHub)
    git(repo, "remote", "add", "origin", "git@github.com:acme/app.git");
  transcript(repo, crypto.randomUUID(), "Earlier work", "cli");
  return repo;
};

// The ticket's work as `/implement-spec` lands it: committed on a branch of its own, then merged
// into the Session's branch. The merge commit's hash.
const land = (cwd: string, ticket: number, files: Record<string, string>) => {
  const branch = `ticket-${ticket}-${crypto.randomUUID().slice(0, 6)}`;
  git(cwd, "checkout", "-q", "-b", branch);
  for (const [path, content] of Object.entries(files))
    writeFileSync(join(cwd, path), content);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", `Ticket #${ticket}`);
  git(cwd, "checkout", "-q", "-");
  git(cwd, "merge", "-q", "--no-ff", branch, "-m", `Merge #${ticket}`);
  return git(cwd, "rev-parse", "HEAD");
};

// The code host, faked: what Fern asked it, in order, by the folder it asked from. While
// `signedOut`, `gh` isn't ready.
interface Asked {
  readonly cwd: string;
  readonly call: string;
  readonly args: Record<string, unknown>;
}
const asked: Array<Asked> = [];
let signedOut = false;
let nextPr = 100;
const askedFrom = (cwd: string) =>
  asked.filter((a) => a.cwd === cwd).map(({ call, args }) => ({ call, args }));
const FakeCodeHost = Layer.succeed(
  CodeHost,
  CodeHost.of({
    ready: () => Effect.sync(() => !signedOut),
    push: (cwd, args) =>
      Effect.sync(() => {
        asked.push({ cwd, call: "push", args });
      }),
    openDraft: (cwd, args) =>
      Effect.sync(() => {
        asked.push({ cwd, call: "openDraft", args });
        const number = ++nextPr;
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
  }),
);

// The Walkthrough writer, faked: it claims every hunk but those in `stray.ts`, in one Section, once
// `gate` (if a test set one) opens.
const requests: Array<WriteRequest> = [];
let gate: Deferred.Deferred<void> | undefined;
const Writer = Layer.succeed(
  WalkthroughWriter,
  WalkthroughWriter.of({
    write: (request) =>
      Effect.gen(function* () {
        requests.push(request);
        if (gate) yield* Deferred.await(gate);
        const draft = {
          sections: [
            {
              title: "The change",
              explanation: "Makes the change.",
              hunks: request.hunks
                .filter((h) => h.path !== "stray.ts")
                .map((h) => h.id),
              decisions: [],
              risk: { level: "low" as const, reason: "Small." },
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
  readonly allowedTools?: Array<string>;
  readonly systemPrompt?: { append?: string };
  readonly mcpServers?: Record<
    string,
    { instance: { _registeredTools: Record<string, FernTool> } }
  >;
}

// Each turn Claude Code is asked to run, and how to end it.
interface StartedTurn {
  readonly sessionId: string | undefined;
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
      started.push({ sessionId, options, finish });
      return ended;
    }),
  };
});

const makeClient = HttpApiTest.groups(FernApi, ["sessions", "projects"]);
const makeLive = RpcTest.makeClient(LiveRpcs);

const fern = Layer.mergeAll(
  handlersWith(Writer, FakeIssues, FakeCodeHost).pipe(
    Layer.provide([
      DatabaseLive(join(dataDir, "fern.db")),
      Layer.succeed(WorktreesDir, { dir: dataDir }),
    ]),
  ),
  HttpServer.layerServices,
);

// A new Session in the Project, and its first turn once it starts.
const startIn = (root: string) =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    const { id } = yield* client.sessions.start({
      payload: { root, message: { text: "Add a dark mode toggle" } },
    });
    const turn = yield* Effect.suspend(() =>
      Effect.fromNullishOr(started.find((t) => t.sessionId === id)),
    ).pipe(
      Effect.retry({ schedule: Schedule.spaced("5 millis"), times: 400 }),
      Effect.orDie,
    );
    return { id, turn, cwd: turn.options.cwd };
  });

const toolOf = (turn: StartedTurn, name: string) =>
  // oxlint-disable-next-line no-underscore-dangle -- the MCP server's own registry
  turn.options.mcpServers?.fern?.instance._registeredTools[name];

// The agent calls one of Fern's tools, as Claude Code would: input checked against its schema,
// then handled.
const callTool = (turn: StartedTurn, name: string, args: unknown) =>
  Effect.promise(() => {
    const tool = toolOf(turn, name);
    if (!tool) throw new Error(`No Fern tool ${name}`);
    return tool.handler(tool.inputSchema.parse(args), {});
  });
const textOf = (result: ToolResult) =>
  result.content.map((c) => c.text).join("");

// The Session's Walkthroughs once they satisfy the condition.
const walkthroughsWhen = (
  id: string,
  condition: (all: ReadonlyArray<Walkthrough>) => boolean,
) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    const [all] = yield* live
      .Walkthroughs({ session: id })
      .pipe(
        Stream.filter(condition),
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("5 seconds"),
        Effect.orDie,
      );
    return all ?? [];
  });

const paths = (w: Walkthrough | undefined) => ({
  sections: w?.sections.flatMap((s) => s.hunks.map((h) => h.path)),
  unexplained: w?.unexplained.map((u) => u.hunk.path),
});

layer(fern, { excludeTestServices: true })("Stacks", (it) => {
  it.effect(
    "gives a Session in a GitHub Project the ticket_landed tool, allowed, with steering that replaces pushing to main",
    () =>
      Effect.gen(function* () {
        const { turn } = yield* startIn(project());
        turn.finish();

        assert.include(
          turn.options.allowedTools ?? [],
          "mcp__fern__ticket_landed",
        );
        assert.match(
          turn.options.systemPrompt?.append ?? "",
          /call Fern's `ticket_landed` tool[^]*never push to `main`/,
        );
      }),
  );

  it.effect(
    "a landed ticket goes up as a draft PR on main, and the next one on top of it, linked into one Stack",
    () =>
      Effect.gen(function* () {
        const { turn, cwd } = yield* startIn(project());
        const branch = git(cwd, "branch", "--show-current");

        const first = land(cwd, 3, { "theme.ts": "export const theme = 1;\n" });
        const answers = [
          yield* callTool(turn, "ticket_landed", { ticket: 3, commit: first }),
        ];
        const second = land(cwd, 4, {
          "toggle.ts": "export const toggle = 1;\n",
        });
        answers.push(
          yield* callTool(turn, "ticket_landed", { ticket: 4, commit: second }),
        );
        turn.finish();

        const numbers = answers.map((a) =>
          Number(/draft PR #(\d+)/.exec(textOf(a))?.[1]),
        );
        assert.deepStrictEqual(
          answers.map((a) => a.isError === true),
          [false, false],
        );
        assert.deepStrictEqual(
          askedFrom(cwd).map(({ call, args }) =>
            call === "openDraft"
              ? { call, args: { ...args, body: "" } }
              : { call, args },
          ),
          [
            {
              call: "push",
              args: { commit: first, branch: `fern/${branch}/t3` },
            },
            {
              call: "openDraft",
              args: {
                head: `fern/${branch}/t3`,
                base: "main",
                title: "Add the theme setting",
                body: "",
              },
            },
            {
              call: "push",
              args: { commit: second, branch: `fern/${branch}/t4` },
            },
            {
              call: "openDraft",
              args: {
                head: `fern/${branch}/t4`,
                base: `fern/${branch}/t3`,
                title: "Toggle in the settings page",
                body: "",
              },
            },
            { call: "link", args: { prs: numbers } },
          ],
        );
        const bodies = askedFrom(cwd)
          .filter((a) => a.call === "openDraft")
          .map((a) => String(a.args.body));
        assert.include(bodies[0], "Closes #3");
        assert.include(bodies[1], "Closes #4");
      }),
  );

  it.effect(
    "each PR's Walkthrough covers only its ticket's change, with what no Section claims shown as Unexplained, and no snapshot Walkthrough after the turn",
    () =>
      Effect.gen(function* () {
        const { id, turn, cwd } = yield* startIn(project());
        const first = land(cwd, 3, { "theme.ts": "export const theme = 1;\n" });
        yield* callTool(turn, "ticket_landed", { ticket: 3, commit: first });
        const second = land(cwd, 4, {
          "toggle.ts": "export const toggle = 1;\n",
          "stray.ts": "export const stray = 1;\n",
        });
        yield* callTool(turn, "ticket_landed", { ticket: 4, commit: second });
        // Work in progress the turn leaves behind belongs to no PR yet.
        writeFileSync(join(cwd, "draft.ts"), "export {};\n");
        turn.finish();

        const all = yield* walkthroughsWhen(
          id,
          (ws) => ws.length === 2 && ws.every((w) => w.status === "ready"),
        );
        assert.deepStrictEqual(
          all.map((w) => [w.since, w.pr?.position, w.pr?.ticket]),
          [
            ["pr", 1, 3],
            ["pr", 2, 4],
          ],
        );
        assert.match(all[0]?.pr?.url ?? "", /\/pull\/\d+$/);
        assert.strictEqual(all[0]?.pr?.title, "Add the theme setting");
        assert.deepStrictEqual(paths(all[0]), {
          sections: ["theme.ts"],
          unexplained: [],
        });
        assert.deepStrictEqual(paths(all[1]), {
          sections: ["toggle.ts"],
          unexplained: ["stray.ts"],
        });

        yield* Effect.sleep("300 millis");
        const after = yield* walkthroughsWhen(id, () => true);
        assert.deepStrictEqual(
          after.map((w) => w.since),
          ["pr", "pr"],
        );
      }),
  );

  it.effect(
    "a PR's Walkthrough waits for the one being written, which carries on to the end",
    () =>
      Effect.gen(function* () {
        const held = yield* Deferred.make<void>();
        gate = held;
        const { id, turn, cwd } = yield* startIn(project());
        yield* callTool(turn, "ticket_landed", {
          ticket: 3,
          commit: land(cwd, 3, { "theme.ts": "export const theme = 1;\n" }),
        });
        yield* callTool(turn, "ticket_landed", {
          ticket: 4,
          commit: land(cwd, 4, { "toggle.ts": "export const toggle = 1;\n" }),
        });

        const waiting = yield* walkthroughsWhen(id, (ws) => ws.length === 2);
        assert.deepStrictEqual(
          waiting.map((w) => w.status),
          ["writing", "writing"],
        );
        assert.strictEqual(
          requests.filter((r) => r.sessionId === id).length,
          1,
        );

        yield* Deferred.succeed(held, undefined);
        gate = undefined;
        const written = yield* walkthroughsWhen(id, (ws) =>
          ws.every((w) => w.status === "ready"),
        );
        turn.finish();
        assert.deepStrictEqual(
          written.map((w) => [w.number, w.pr?.ticket, w.status]),
          [
            [1, 3, "ready"],
            [2, 4, "ready"],
          ],
        );
        assert.deepStrictEqual(
          requests
            .filter((r) => r.sessionId === id)
            .map((r) => r.hunks.map((h) => h.path)),
          [["theme.ts"], ["toggle.ts"]],
        );
      }).pipe(Effect.ensuring(Effect.sync(() => (gate = undefined)))),
  );

  it.effect(
    "a commit off the Session's branch, or one that doesn't build on the top PR, is refused and nothing reaches GitHub",
    () =>
      Effect.gen(function* () {
        const root = project();
        const { turn, cwd } = yield* startIn(root);
        const elsewhere = git(root, "rev-parse", "HEAD");
        writeFileSync(join(root, "b.ts"), "export const b = 1;\n");
        git(root, "add", "-A");
        git(root, "commit", "-q", "-m", "On main");
        const offBranch = git(root, "rev-parse", "HEAD");

        const off = yield* callTool(turn, "ticket_landed", {
          ticket: 3,
          commit: offBranch,
        });
        const unchanged = yield* callTool(turn, "ticket_landed", {
          ticket: 3,
          commit: elsewhere,
        });
        turn.finish();

        assert.isTrue(off.isError);
        assert.include(textOf(off), "isn't on this Session's branch");
        assert.isTrue(unchanged.isError);
        assert.include(textOf(unchanged), "changes nothing");
        assert.deepStrictEqual(askedFrom(cwd), []);
      }),
  );

  it.effect(
    "off GitHub, a Session gets no ticket_landed tool, and a finished turn writes its Walkthrough as before",
    () =>
      Effect.gen(function* () {
        const { id, turn, cwd } = yield* startIn(project({ offGitHub: true }));
        writeFileSync(join(cwd, "toggle.ts"), "export {};\n");
        turn.finish();

        assert.isUndefined(toolOf(turn, "ticket_landed"));
        assert.notInclude(
          turn.options.systemPrompt?.append ?? "",
          "ticket_landed",
        );
        const all = yield* walkthroughsWhen(id, (ws) => ws.length > 0);
        assert.strictEqual(all[0]?.since, "start");
        assert.isUndefined(all[0]?.pr);
      }),
  );

  it.effect("with gh signed out, a Session gets no ticket_landed tool", () =>
    Effect.gen(function* () {
      signedOut = true;
      const { turn } = yield* startIn(project());
      turn.finish();

      assert.isUndefined(toolOf(turn, "ticket_landed"));
    }).pipe(Effect.ensuring(Effect.sync(() => (signedOut = false)))),
  );

  it.effect(
    "a Project opted out in Settings lands as before: new Sessions get no tool, and a report from one already running is refused",
    () =>
      Effect.gen(function* () {
        const root = project();
        const client = yield* makeClient;
        const running = yield* startIn(root);
        const before = yield* client.projects.settings({ query: { root } });

        const saved = yield* client.projects.saveSettings({
          payload: { root, stacks: false },
        });
        const after = yield* client.projects.settings({ query: { root } });
        const { turn } = yield* startIn(root);
        turn.finish();
        const refused = yield* callTool(running.turn, "ticket_landed", {
          ticket: 3,
          commit: land(running.cwd, 3, { "theme.ts": "export {};\n" }),
        });
        running.turn.finish();

        assert.isTrue(before.stacks);
        assert.isFalse(saved.stacks);
        assert.isFalse(after.stacks);
        assert.isUndefined(toolOf(turn, "ticket_landed"));
        assert.isTrue(refused.isError);
        assert.include(textOf(refused), "doesn't land as a Stack");
        assert.deepStrictEqual(askedFrom(running.cwd), []);
      }),
  );

  it.effect("a folder Fern doesn't know as a Project has no settings", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const root = realpathSync(mkdtempSync(join(tmpdir(), "fern-nowhere-")));
      const error = yield* client.projects
        .saveSettings({ payload: { root, stacks: false } })
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "ProjectNotFound");
    }),
  );
});
