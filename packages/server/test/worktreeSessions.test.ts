import { assert, layer } from "@effect/vitest";
import { FernApi, LiveRpcs } from "@repo/api";
import { Effect, Layer, Schedule, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { RpcTest } from "effect/rpc";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import { WorktreesDir } from "../src/worktree/Worktrees";
import { NoWriter } from "./stubs";

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
// Sessions the developer runs come from the CLI; Fern's from the SDK.
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
      timestamp: new Date().toISOString(),
      cwd,
      entrypoint,
      userType: "external",
      message: { role: "user", content: text },
    })}\n`,
  );
};

// A repo on `main` with one commit, and a branch checked out that isn't `main`, so a Session can
// only start from `main` by asking for it.
const repo = realpathSync(mkdtempSync(join(tmpdir(), "fern-repo-")));
git(repo, "init", "-q", "-b", "main");
writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
git(repo, "add", "-A");
git(repo, "commit", "-q", "-m", "Initial");
const mainTip = git(repo, "rev-parse", "main");
git(repo, "checkout", "-q", "-b", "elsewhere");
writeFileSync(join(repo, "a.ts"), "export const a = 2;\n");
git(repo, "commit", "-q", "-am", "Not on main");
// The developer has run a Session in it, which makes it a Project.
transcript(repo, crypto.randomUUID(), "Earlier work", "cli");

// Each turn Claude Code is asked to run: where, on which Session, and its first message.
interface StartedTurn {
  readonly cwd: string;
  readonly sessionId: string | undefined;
  readonly text: string;
}
const started: Array<StartedTurn> = [];

// Only the Agent SDK's query() is faked: it records the turn, writes the transcript as Claude Code
// would, and ends the turn at once.
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  query: ({
    prompt,
    options,
  }: {
    prompt: AsyncIterable<{ message: { content: Array<{ text?: string }> } }>;
    options: { cwd: string; sessionId?: string; resume?: string };
  }) => {
    async function* events() {
      const first = await prompt[Symbol.asyncIterator]().next();
      const text = first.done
        ? ""
        : (first.value.message.content.find((part) => part.text)?.text ?? "");
      const sessionId = options.sessionId ?? options.resume;
      started.push({ cwd: options.cwd, sessionId, text });
      if (options.sessionId) transcript(options.cwd, options.sessionId, text);
      yield { type: "system", subtype: "init", model: "claude-test" };
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

const makeClient = HttpApiTest.groups(FernApi, ["sessions"]);
const makeLive = RpcTest.makeClient(LiveRpcs);

const first = <A, E>(stream: Stream.Stream<A, E>) =>
  stream.pipe(
    Stream.take(1),
    Stream.runCollect,
    Effect.map(([a]) => a),
    Effect.timeout("5 seconds"),
  );

const startSession = (text: string) =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    const { id } = yield* client.sessions.start({
      payload: { root: repo, message: { text } },
    });
    const turn = yield* Effect.suspend(() =>
      Effect.fromNullishOr(started.find((t) => t.sessionId === id)),
    ).pipe(
      Effect.retry({ schedule: Schedule.spaced("5 millis"), times: 200 }),
      Effect.orDie,
    );
    return { id, turn };
  });

layer(
  Layer.mergeAll(
    handlersWith(NoWriter).pipe(
      Layer.provide([
        DatabaseLive(":memory:"),
        Layer.succeed(WorktreesDir, { dir: dataDir }),
      ]),
    ),
    HttpServer.layerServices,
  ),
  { excludeTestServices: true },
)("Worktree Sessions", (it) => {
  it.effect(
    "starts a Session on its own branch from main, in a worktree outside the repo, in the Grill",
    () =>
      Effect.gen(function* () {
        const { turn } = yield* startSession("Add a dark mode toggle!");

        assert.strictEqual(
          turn.text,
          "/grill-with-docs Add a dark mode toggle!",
        );
        assert.isTrue(turn.cwd.startsWith(`${dataDir}/`));
        assert.isFalse(turn.cwd.startsWith(`${repo}/`));
        const branch = git(turn.cwd, "branch", "--show-current");
        assert.match(branch, /^add-a-dark-mode-toggle-[a-z0-9]{6}$/);
        assert.strictEqual(git(turn.cwd, "rev-parse", "HEAD"), mainTip);
        assert.strictEqual(git(repo, "rev-parse", branch), mainTip);
        // The developer's checkout is left as it was.
        assert.strictEqual(git(repo, "branch", "--show-current"), "elsewhere");
      }),
  );

  it.effect(
    "lists a worktree Session under its repo's Project, with its branch and worktree",
    () =>
      Effect.gen(function* () {
        const { id, turn } = yield* startSession("Rename the settings page");
        const live = yield* makeLive;
        const projects = yield* first(
          live
            .Projects()
            .pipe(
              Stream.filter((all) =>
                all.some((p) => p.sessions.some((s) => s.id === id)),
              ),
            ),
        );

        assert.deepStrictEqual(
          projects?.map((p) => p.path),
          [repo],
        );
        const session = projects?.[0]?.sessions.find((s) => s.id === id);
        assert.strictEqual(session?.worktree, turn.cwd);
        assert.match(session?.gitBranch ?? "", /^rename-the-settings-page-/);
      }),
  );

  it.effect(
    "only the Hosted Session a worktree was made for owns it, not a terminal Session run there",
    () =>
      Effect.gen(function* () {
        const { id, turn } = yield* startSession("Fix the footer");
        const terminal = crypto.randomUUID();
        transcript(turn.cwd, terminal, "Check the footer", "cli");
        const live = yield* makeLive;
        const projects = yield* first(
          live
            .Projects()
            .pipe(
              Stream.filter((all) =>
                all.some((p) => p.sessions.some((s) => s.id === terminal)),
              ),
            ),
        );

        const sessions = projects?.find((p) => p.path === repo)?.sessions;
        const hosted = sessions?.find((s) => s.id === id);
        const outside = sessions?.find((s) => s.id === terminal);
        assert.strictEqual(outside?.worktree, turn.cwd);
        assert.isTrue(hosted?.ownWorktree);
        assert.isNotTrue(outside?.ownWorktree);
      }),
  );

  it.effect(
    "keeps two Sessions' edits apart, each read from its own worktree",
    () =>
      Effect.gen(function* () {
        const one = yield* startSession("Fix the login bug");
        const two = yield* startSession("Fix the login bug");
        assert.notStrictEqual(one.turn.cwd, two.turn.cwd);

        // The first Session's agent edits a file and adds one.
        writeFileSync(join(one.turn.cwd, "a.ts"), "export const a = 10;\n");
        writeFileSync(join(one.turn.cwd, "login.ts"), "export {};\n");

        const live = yield* makeLive;
        const changed = (session: { id: string; turn: StartedTurn }) =>
          first(
            live.Changes({ root: session.turn.cwd, session: session.id }),
          ).pipe(Effect.map((c) => c?.files.map((f) => f.path)));
        assert.deepStrictEqual(yield* changed(one), ["a.ts", "login.ts"]);
        assert.deepStrictEqual(yield* changed(two), []);

        const files = (session: { turn: StartedTurn }) =>
          first(live.ProjectFiles({ root: session.turn.cwd }));
        assert.deepStrictEqual(yield* files(one), ["a.ts", "login.ts"]);
        assert.deepStrictEqual(yield* files(two), ["a.ts"]);

        const content = (session: { turn: StartedTurn }) =>
          first(live.File({ root: session.turn.cwd, path: "a.ts" })).pipe(
            Effect.map((file) => file?.content),
          );
        assert.strictEqual(yield* content(one), "export const a = 10;\n");
        assert.strictEqual(yield* content(two), "export const a = 1;\n");
        // Nor do they reach the developer's checkout.
        assert.isFalse(existsSync(join(repo, "login.ts")));
      }),
  );

  it.effect(
    "starts a Session in place, in the Grill, in a folder outside git or in a repo with no commits yet",
    () =>
      Effect.gen(function* () {
        const outside = realpathSync(
          mkdtempSync(join(tmpdir(), "fern-plain-")),
        );
        const empty = realpathSync(mkdtempSync(join(tmpdir(), "fern-empty-")));
        git(empty, "init", "-q", "-b", "main");
        const client = yield* makeClient;
        const live = yield* makeLive;
        for (const folder of [outside, empty]) {
          transcript(folder, crypto.randomUUID(), "Earlier work", "cli");
          const { id } = yield* client.sessions.start({
            payload: { root: folder, message: { text: "Tidy up" } },
          });
          const turn = yield* Effect.suspend(() =>
            Effect.fromNullishOr(started.find((t) => t.sessionId === id)),
          ).pipe(
            Effect.retry({ schedule: Schedule.spaced("5 millis"), times: 200 }),
            Effect.orDie,
          );

          assert.strictEqual(turn.cwd, folder);
          assert.strictEqual(turn.text, "/grill-with-docs Tidy up");
          const flow = yield* first(live.Flow({ session: id }));
          assert.deepStrictEqual(
            flow?.phases.map((p) => `${p.phase}:${p.status}`),
            [
              "grill:current",
              "spec:notStarted",
              "implement:notStarted",
              "retro:notStarted",
            ],
          );
          const phases = yield* first(live.SessionPhases());
          assert.strictEqual(
            phases?.find((p) => p.sessionId === id)?.current,
            "grill",
          );
        }
      }),
  );

  // As /clear does from a Session already in a worktree.
  it.effect(
    "starts a Session from a worktree Session's folder on main, under the same Project",
    () =>
      Effect.gen(function* () {
        const one = yield* startSession("Tidy the README");
        const client = yield* makeClient;
        const { id } = yield* client.sessions.start({
          payload: { root: one.turn.cwd, message: { text: "Next thing" } },
        });
        const live = yield* makeLive;
        const projects = yield* first(
          live
            .Projects()
            .pipe(
              Stream.filter((all) =>
                all.some((p) => p.sessions.some((s) => s.id === id)),
              ),
            ),
        );
        const project = projects?.find((p) =>
          p.sessions.some((s) => s.id === id),
        );
        assert.strictEqual(project?.path, repo);
        const worktree =
          project?.sessions.find((s) => s.id === id)?.worktree ?? "";
        assert.notStrictEqual(worktree, one.turn.cwd);
        assert.strictEqual(git(worktree, "rev-parse", "HEAD"), mainTip);
      }),
  );
});
