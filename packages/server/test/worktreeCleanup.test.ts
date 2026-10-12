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
import { CleanupInterval } from "../src/worktree/WorktreeCleanup";
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

// A repo on `main` with one commit, which the developer has run a Session in, making it a Project.
const repo = realpathSync(mkdtempSync(join(tmpdir(), "fern-repo-")));
git(repo, "init", "-q", "-b", "main");
writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
git(repo, "add", "-A");
git(repo, "commit", "-q", "-m", "Initial");
transcript(repo, crypto.randomUUID(), "Earlier work", "cli");

const started: Array<{ cwd: string; sessionId: string | undefined }> = [];

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
      if (options.sessionId) transcript(options.cwd, options.sessionId, text);
      started.push({ cwd: options.cwd, sessionId });
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

// Starts a Session through the API and waits for its first turn, returning its id and worktree.
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
    const branch = git(turn.cwd, "branch", "--show-current");
    return { id, worktree: turn.cwd, branch };
  });

// Whether the sidebar lists the Session, once it settles on `listed`.
const sidebarListing = (id: string, listed: boolean) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    yield* live.Projects().pipe(
      Stream.filter(
        (all) =>
          all.some((p) => p.sessions.some((s) => s.id === id)) === listed,
      ),
      Stream.take(1),
      Stream.runDrain,
      Effect.timeout("10 seconds"),
    );
  });

const branchExists = (branch: string) =>
  git(repo, "branch", "--list", branch) !== "";

// Commits a new file in the checkout at `cwd`.
const commit = (cwd: string, file: string) => {
  writeFileSync(join(cwd, file), `export const name = "${file}";\n`);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", `Add ${file}`);
};

layer(
  Layer.mergeAll(
    handlersWith(NoWriter).pipe(
      Layer.provide([
        DatabaseLive(":memory:"),
        Layer.succeed(WorktreesDir, { dir: dataDir }),
        // Look for merged branches often, rather than every few minutes.
        Layer.succeed(CleanupInterval, "100 millis"),
      ]),
    ),
    HttpServer.layerServices,
  ),
  { excludeTestServices: true },
)("Worktree cleanup", (it) => {
  it.effect(
    "archiving a clean Session removes its worktree and hides it from the sidebar, keeping its branch",
    () =>
      Effect.gen(function* () {
        const { id, worktree, branch } = yield* startSession("Clean work");
        yield* sidebarListing(id, true);
        const client = yield* makeClient;

        yield* client.sessions.archive({ params: { id }, payload: {} });

        assert.isFalse(existsSync(worktree));
        assert.isTrue(branchExists(branch));
        yield* sidebarListing(id, false);
      }),
  );

  it.effect(
    "refuses to archive a Session with uncommitted changes, untracked files included, until forced",
    () =>
      Effect.gen(function* () {
        const { id, worktree, branch } = yield* startSession("Dirty work");
        writeFileSync(join(worktree, "draft.ts"), "export {};\n");
        const client = yield* makeClient;

        const refused = yield* client.sessions
          .archive({ params: { id }, payload: {} })
          .pipe(Effect.flip);

        assert.strictEqual(refused._tag, "UncommittedChanges");
        assert.isTrue(existsSync(join(worktree, "draft.ts")));
        yield* sidebarListing(id, true);

        yield* client.sessions.archive({
          params: { id },
          payload: { force: true },
        });

        assert.isFalse(existsSync(worktree));
        assert.isTrue(branchExists(branch));
        yield* sidebarListing(id, false);
      }),
  );

  it.effect(
    "removes the clean worktree of a Session whose branch merged into main, and archives it",
    () =>
      Effect.gen(function* () {
        const { id, worktree, branch } = yield* startSession("Merged work");
        commit(worktree, "merged.ts");
        git(repo, "merge", "-q", "--no-ff", "--no-edit", branch);

        yield* sidebarListing(id, false);
        assert.isFalse(existsSync(worktree));
        assert.isTrue(branchExists(branch));
      }),
  );

  it.effect(
    "counts a squash-merged branch as merged once merging it again would change nothing on main, even after main moves on",
    () =>
      Effect.gen(function* () {
        const { id, worktree, branch } = yield* startSession("Squashed work");
        commit(worktree, "squashed-1.ts");
        commit(worktree, "squashed-2.ts");
        git(repo, "merge", "-q", "--squash", branch);
        git(repo, "commit", "-q", "-m", "Squashed work");
        commit(repo, "later-on-main.ts");

        yield* sidebarListing(id, false);
        assert.isFalse(existsSync(worktree));
      }),
  );

  it.effect(
    "keeps the worktree of a Session with no commits yet, an unmerged branch, or uncommitted changes",
    () =>
      Effect.gen(function* () {
        const fresh = yield* startSession("Fresh work");
        const unmerged = yield* startSession("Unmerged work");
        commit(unmerged.worktree, "unmerged.ts");
        const dirty = yield* startSession("Merged but dirty work");
        commit(dirty.worktree, "dirty.ts");
        writeFileSync(join(dirty.worktree, "a.ts"), "export const a = 3;\n");
        git(repo, "merge", "-q", "--no-ff", "--no-edit", dirty.branch);
        // A merged one alongside, so its removal shows a cleanup ran after all of them were set up.
        const merged = yield* startSession("Merged alongside");
        commit(merged.worktree, "alongside.ts");
        git(repo, "merge", "-q", "--no-ff", "--no-edit", merged.branch);

        yield* sidebarListing(merged.id, false);
        yield* Effect.sleep("300 millis");

        for (const kept of [fresh, unmerged, dirty]) {
          assert.isTrue(existsSync(kept.worktree), kept.branch);
          yield* sidebarListing(kept.id, true);
        }
        assert.strictEqual(
          git(dirty.worktree, "status", "--porcelain"),
          "M a.ts",
        );
      }),
  );
});
