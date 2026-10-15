import { assert, it as test, layer } from "@effect/vitest";
import { FernApi, type Flow, LiveRpcs, WalkthroughError } from "@repo/api";
import {
  Deferred,
  type Duration,
  Effect,
  Layer,
  Option,
  Schedule,
  Stream,
} from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { RpcTest } from "effect/rpc";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { DatabaseLive } from "../src/database/Database";
import { IssueTrackerTimeout } from "../src/flow/Flows";
import { handlersWith } from "../src/http";
import { IssueTracker, type TrackedIssue } from "../src/issue/IssueTracker";
import {
  WalkthroughWriter,
  type WriteRequest,
} from "../src/walkthrough/WalkthroughWriter";
import { WorktreesDir } from "../src/worktree/Worktrees";

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

// The issue tracker, faked: the Brief #2 and its tickets #3 and #4, whose states a test sets.
const issue = (
  number: number,
  title: string,
  state: TrackedIssue["state"],
): TrackedIssue => ({
  number,
  title,
  url: `https://github.com/acme/app/issues/${number}`,
  state,
});
const issues = new Map<number, TrackedIssue>();
const closeTickets = (...open: Array<number>) => {
  issues.set(2, issue(2, "Dark mode", "open"));
  issues.set(
    3,
    issue(3, "Add the theme setting", open.includes(3) ? "open" : "closed"),
  );
  issues.set(
    4,
    issue(
      4,
      "Toggle in the settings page",
      open.includes(4) ? "open" : "closed",
    ),
  );
};
closeTickets();
// While `hanging`, the tracker never answers; `asked` counts the questions it left hanging.
let hanging = false;
let asked = 0;
const Issues = Layer.succeed(
  IssueTracker,
  IssueTracker.of({
    issue: (_cwd, number) =>
      Effect.suspend(() => {
        if (!hanging)
          return Effect.succeed(Option.fromNullishOr(issues.get(number)));
        asked++;
        return Effect.never;
      }),
  }),
);

// The Walkthrough writer, faked: it claims every hunk in one Section, once `gate` (if a test set
// one) opens. While `failing`, the Fork fails instead.
const requests: Array<WriteRequest> = [];
let gate: Deferred.Deferred<void> | undefined;
let failing = false;
const Writer = Layer.succeed(
  WalkthroughWriter,
  WalkthroughWriter.of({
    write: (request) =>
      Effect.gen(function* () {
        requests.push(request);
        if (gate) yield* Deferred.await(gate);
        if (failing)
          return yield* new WalkthroughError({ message: "The Fork crashed." });
        const draft = {
          sections: [
            {
              title: "The toggle",
              explanation: "Adds the toggle.",
              hunks: request.hunks.map((h) => h.id),
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

// One turn Claude Code is asked to run: on which Session, and its first message.
interface StartedTurn {
  readonly sessionId: string;
  readonly text: string;
  readonly options: Record<string, unknown>;
}
const started: Array<StartedTurn> = [];
// Sessions whose Walkthrough Fern started writing before their Implement turn ended.
const writtenInTurn = new Set<string>();
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
// Fern's answers to the agent's Phase-done reports, by Session.
const answers: Array<{
  sessionId: string;
  phase: string;
  text: string;
  isError: boolean;
}> = [];

interface ToolServer {
  readonly instance: {
    readonly _registeredTools: Record<
      string,
      {
        readonly handler: (
          args: Record<string, unknown>,
          extra: unknown,
        ) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
      }
    >;
  };
}

// Whether the agent changes code while it implements; a test may turn it off and puts it back after.
let editing = true;

// The agent follows the Flow: it reports each Phase done in the turn its command started, and
// changes a file in its worktree while it implements. Told Implement isn't done, it changes another
// file and reports it done again.
const agent = async ({ sessionId, text, options }: StartedTurn) => {
  const report = async (phase: string, extra: Record<string, unknown> = {}) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const servers = options.mcpServers as Record<string, ToolServer>;
    // oxlint-disable-next-line no-underscore-dangle
    const tool = servers.fern?.instance._registeredTools.phase_done;
    if (!tool) throw new Error("No Fern tool phase_done");
    const result = await tool.handler(
      { phase, summary: `${phase} done.`, ...extra },
      {},
    );
    answers.push({
      sessionId,
      phase,
      text: result.content.map((c) => c.text).join(""),
      isError: result.isError === true,
    });
  };
  if (text.startsWith("/grill-with-docs")) await report("grill");
  else if (text === "/to-tickets")
    await report("spec", { spec: { brief: 2, tickets: [3, 4] } });
  else if (text.includes("declined the Checkpoint at the end of Implement")) {
    writeFileSync(join(String(options.cwd), "fix.ts"), "export {};\n");
    await report("implement");
  } else if (text.startsWith("/implement-spec")) {
    if (editing)
      writeFileSync(join(String(options.cwd), "toggle.ts"), "export {};\n");
    await report("implement");
    for (let i = 0; i < 100 && !answers.at(-1)?.isError; i++) {
      if (requests.some((r) => r.sessionId === sessionId)) {
        writtenInTurn.add(sessionId);
        break;
      }
      await settle();
    }
  }
};

// Only the Agent SDK's query() is faked: it records the turn, writes the transcript as Claude Code
// would, lets the agent act, then ends the turn.
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const { scriptedQuery } = await import("./fakeClaude");
  return {
    ...(await importOriginal<object>()),
    query: scriptedQuery(async ({ sessionId, text, options, first }) => {
      const turn = { sessionId, text, options };
      started.push(turn);
      if (first && typeof options.sessionId === "string")
        transcript(String(options.cwd), options.sessionId, text);
      await agent(turn);
    }),
  };
});

const makeClient = HttpApiTest.groups(FernApi, [
  "sessions",
  "flows",
  "autonomy",
]);
const makeLive = RpcTest.makeClient(LiveRpcs);

// Fern's API on a database file, as the app runs it, waiting on the issue tracker as long as
// `patience`, if given.
const server = (database: string, patience?: Duration.Input) =>
  Layer.mergeAll(
    handlersWith(Writer, Issues).pipe(
      Layer.provide([
        DatabaseLive(database),
        Layer.succeed(WorktreesDir, { dir: dataDir }),
        ...(patience === undefined
          ? []
          : [Layer.succeed(IssueTrackerTimeout, patience)]),
      ]),
    ),
    HttpServer.layerServices,
  );
// Runs the effect against its own server on the database, shut down after: one run of Fern.
const runOn =
  (database: string, patience?: Duration.Input) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const context = yield* Layer.build(server(database, patience));
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
    Effect.orDie,
  );

// Waits until the predicate holds.
const eventually = <A>(find: () => A | undefined) =>
  Effect.suspend(() => Effect.fromNullishOr(find())).pipe(
    Effect.retry({ schedule: Schedule.spaced("5 millis"), times: 400 }),
    Effect.orDie,
  );

const turnWhere = (sessionId: string, predicate: (text: string) => boolean) =>
  eventually(() =>
    started.find((t) => t.sessionId === sessionId && predicate(t.text)),
  );

const answerTo = (sessionId: string, phase: string) =>
  eventually(() =>
    answers.find((a) => a.sessionId === sessionId && a.phase === phase),
  );

const flowOf = (sessionId: string, predicate: (f: Flow | null) => boolean) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    return yield* firstWhere(live.Flow({ session: sessionId }), predicate);
  });

const approveAt = (sessionId: string, phase: string) =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    const flow = yield* flowOf(
      sessionId,
      (f) => f?.checkpoint?.phase === phase,
    );
    yield* client.flows.approve({ params: { id: flow?.checkpoint?.id ?? "" } });
  });

// A new Session in the Project, taken through Grill and Spec, whose agent has reported Implement
// done.
const implemented = (root: string) =>
  Effect.gen(function* () {
    const client = yield* makeClient;
    const { id } = yield* client.sessions.start({
      payload: {
        root,
        message: { text: "/grill-with-docs Add a dark mode toggle" },
      },
    });
    yield* approveAt(id, "grill");
    yield* approveAt(id, "spec");
    yield* answerTo(id, "implement");
    return id;
  });

const statuses = (flow: Flow | null | undefined) =>
  flow?.phases.map((p) => `${p.phase}:${p.status}`);

// Holds the Walkthrough writer until `open` runs.
const holdingWriter = Effect.gen(function* () {
  const held = yield* Deferred.make<void>();
  gate = held;
  return {
    open: Deferred.succeed(held, undefined).pipe(
      Effect.andThen(Effect.sync(() => (gate = undefined))),
    ),
  };
});

// A Project where the developer has accepted Autonomy at the end of Implement.
const autonomousImplement = Effect.gen(function* () {
  const root = project();
  const client = yield* makeClient;
  const live = yield* makeLive;
  let last = "";
  for (let i = 0; i < 5; i++) {
    last = yield* implemented(root);
    yield* approveAt(last, "implement");
  }
  const autonomy = yield* firstWhere(
    live.Autonomy({ session: last }),
    (a) =>
      a?.boundaries.find((b) => b.boundary === "implement")?.offer !==
      undefined,
  );
  const offer = autonomy?.boundaries.find(
    (b) => b.boundary === "implement",
  )?.offer;
  yield* client.autonomy.accept({ params: { id: offer?.id ?? "" } });
  return root;
});

layer(server(freshDatabase()), { excludeTestServices: true })(
  "Implement exit",
  (it) => {
    it.effect(
      "with tickets still open, raises no Checkpoint and tells the agent which ones",
      () =>
        Effect.gen(function* () {
          closeTickets(3);
          const id = yield* implemented(project());
          const answer = yield* answerTo(id, "implement");

          assert.isTrue(answer.isError);
          assert.include(answer.text, "#3 Add the theme setting");
          assert.notInclude(answer.text, "#4");
          const flow = yield* flowOf(id, () => true);
          assert.isUndefined(flow?.checkpoint);
          assert.deepStrictEqual(statuses(flow), [
            "grill:done",
            "spec:done",
            "implement:current",
            "retro:notStarted",
          ]);
        }).pipe(Effect.ensuring(Effect.sync(() => closeTickets()))),
    );

    it.effect(
      "with every ticket closed and no Walkthrough yet, writes one and raises the Checkpoint once it's written, linking to it",
      () =>
        Effect.gen(function* () {
          const { open } = yield* holdingWriter;
          const id = yield* implemented(project());
          const answer = yield* answerTo(id, "implement");
          assert.isFalse(answer.isError);
          assert.include(answer.text, "Walkthrough");
          yield* eventually(() => (writtenInTurn.has(id) ? true : undefined));

          // While the Fork writes, the developer has no Checkpoint.
          const live = yield* makeLive;
          const writing = yield* firstWhere(
            live.Walkthroughs({ session: id }),
            (all) => all.length > 0,
          );
          assert.strictEqual(writing?.[0]?.status, "writing");
          const meanwhile = yield* flowOf(id, () => true);
          assert.isUndefined(
            meanwhile?.checkpoint,
            JSON.stringify([meanwhile?.checkpoint, answer.text]),
          );

          yield* open;
          const flow = yield* flowOf(id, (f) => f?.checkpoint !== undefined);
          const written = yield* firstWhere(
            live.Walkthroughs({ session: id }),
            (all) => all[0]?.status === "ready",
          );
          const walkthrough = written?.[0];
          assert.strictEqual(flow?.checkpoint?.phase, "implement");
          assert.deepStrictEqual(flow?.checkpoint?.walkthrough, {
            id: walkthrough?.id ?? "",
            number: 1,
          });
        }),
    );

    it.effect(
      "with code changed since the last Walkthrough, writes a new one and links the Checkpoint to it, not the stale one",
      () =>
        Effect.gen(function* () {
          const id = yield* implemented(project());
          const first = yield* flowOf(
            id,
            (f) => f?.checkpoint?.walkthrough !== undefined,
          );
          assert.strictEqual(first?.checkpoint?.walkthrough?.number, 1);

          // The developer declines; the agent changes more code and reports Implement done again.
          const client = yield* makeClient;
          yield* client.flows.decline({
            params: { id: first?.checkpoint?.id ?? "" },
            payload: { note: "Handle the system theme too." },
          });

          const flow = yield* flowOf(
            id,
            (f) =>
              f?.checkpoint !== undefined &&
              f.checkpoint.id !== first?.checkpoint?.id,
          );
          const live = yield* makeLive;
          const walkthroughs = yield* firstWhere(
            live.Walkthroughs({ session: id }),
            (all) => all.some((w) => w.number === 2 && w.status === "ready"),
          );
          assert.deepStrictEqual(flow?.checkpoint?.walkthrough, {
            id: walkthroughs?.find((w) => w.number === 2)?.id ?? "",
            number: 2,
          });
        }),
    );

    it.effect(
      "when the Walkthrough can't be written, raises nothing and tells the agent",
      () =>
        Effect.gen(function* () {
          failing = true;
          const id = yield* implemented(project());

          const told = yield* turnWhere(id, (text) =>
            text.includes("couldn't write the Session's Walkthrough"),
          );
          assert.include(told.text, "Report Implement done again");
          const flow = yield* flowOf(id, () => true);
          assert.isUndefined(flow?.checkpoint);
          assert.deepStrictEqual(statuses(flow), [
            "grill:done",
            "spec:done",
            "implement:current",
            "retro:notStarted",
          ]);
        }).pipe(Effect.ensuring(Effect.sync(() => (failing = false)))),
    );

    it.effect(
      "in a folder outside git, where nothing can be reviewed, raises the Checkpoint without a Walkthrough",
      () =>
        Effect.gen(function* () {
          const folder = realpathSync(
            mkdtempSync(join(tmpdir(), "fern-plain-")),
          );
          transcript(folder, crypto.randomUUID(), "Earlier work", "cli");
          const id = yield* implemented(folder);

          const flow = yield* flowOf(id, (f) => f?.checkpoint !== undefined);
          assert.strictEqual(flow?.checkpoint?.phase, "implement");
          assert.isUndefined(flow?.checkpoint?.walkthrough);
        }),
    );

    it.effect("approving the Implement Checkpoint sends /retro", () =>
      Effect.gen(function* () {
        const id = yield* implemented(project());
        yield* approveAt(id, "implement");

        yield* turnWhere(id, (text) => text === "/retro");
        const flow = yield* flowOf(id, (f) => f?.phases[2]?.status === "done");
        assert.deepStrictEqual(statuses(flow), [
          "grill:done",
          "spec:done",
          "implement:done",
          "retro:current",
        ]);
      }),
    );

    it.effect(
      "under Autonomy at the end of Implement, approves it only once the Walkthrough is written",
      () =>
        Effect.gen(function* () {
          const root = yield* autonomousImplement;
          const { open } = yield* holdingWriter;
          const id = yield* implemented(root);
          yield* eventually(() => (writtenInTurn.has(id) ? true : undefined));
          yield* Effect.sleep("300 millis");
          assert.isUndefined(
            started.find((t) => t.sessionId === id && t.text === "/retro"),
          );
          const meanwhile = yield* flowOf(id, () => true);
          assert.isUndefined(meanwhile?.checkpoint);
          assert.strictEqual(meanwhile?.phases[2]?.status, "current");

          yield* open;
          yield* turnWhere(id, (text) => text === "/retro");
          const flow = yield* flowOf(
            id,
            (f) => f?.phases[2]?.status === "done",
          );
          assert.isUndefined(flow?.checkpoint);
          const live = yield* makeLive;
          const walkthroughs = yield* firstWhere(
            live.Walkthroughs({ session: id }),
            () => true,
          );
          assert.strictEqual(walkthroughs?.[0]?.status, "ready");
        }),
    );

    it.effect(
      "with nothing changed and no Walkthrough at all, raises the Checkpoint without a link, even under Autonomy",
      () =>
        Effect.gen(function* () {
          const root = yield* autonomousImplement;
          editing = false;
          const id = yield* implemented(root);

          const flow = yield* flowOf(id, (f) => f?.checkpoint !== undefined);
          assert.strictEqual(flow?.checkpoint?.phase, "implement");
          assert.isUndefined(flow?.checkpoint?.walkthrough);
          assert.isUndefined(
            started.find((t) => t.sessionId === id && t.text === "/retro"),
          );
        }).pipe(Effect.ensuring(Effect.sync(() => (editing = true)))),
    );
  },
);

test.live(
  "raises a held Implement Checkpoint after Fern restarts, once the Walkthrough is written",
  () =>
    Effect.gen(function* () {
      const database = freshDatabase();
      const root = project();
      // Fern stops while the Fork is still writing.
      const id = yield* Effect.gen(function* () {
        yield* holdingWriter;
        const session = yield* implemented(root);
        yield* eventually(() =>
          writtenInTurn.has(session) ? true : undefined,
        );
        return session;
      }).pipe(
        runOn(database),
        Effect.ensuring(Effect.sync(() => (gate = undefined))),
      );

      const { flow, walkthroughs } = yield* Effect.gen(function* () {
        const live = yield* makeLive;
        return {
          flow: yield* flowOf(id, (f) => f?.checkpoint !== undefined),
          walkthroughs: yield* firstWhere(
            live.Walkthroughs({ session: id }),
            () => true,
          ),
        };
      }).pipe(runOn(database));
      const written = walkthroughs?.find((w) => w.status === "ready");
      assert.strictEqual(flow?.checkpoint?.phase, "implement");
      assert.deepStrictEqual(flow?.checkpoint?.walkthrough, {
        id: written?.id ?? "",
        number: written?.number ?? 0,
      });
    }),
);

test.live(
  "while the issue tracker keeps one Session waiting, other Sessions' Checkpoints are still decided, and the agent hears once Fern gives up",
  () =>
    Effect.gen(function* () {
      const root = project();
      const client = yield* makeClient;
      const other = yield* client.sessions.start({
        payload: {
          root,
          message: { text: "/grill-with-docs Rename the settings page" },
        },
      });
      const waiting = yield* flowOf(
        other.id,
        (f) => f?.checkpoint?.phase === "grill",
      );

      // This Session reports Spec done, and the tracker never answers Fern's check.
      hanging = true;
      const { id } = yield* client.sessions.start({
        payload: {
          root,
          message: { text: "/grill-with-docs Add a dark mode toggle" },
        },
      });
      yield* approveAt(id, "grill");
      yield* eventually(() => (asked > 0 ? true : undefined));

      yield* client.flows
        .approve({ params: { id: waiting?.checkpoint?.id ?? "" } })
        .pipe(Effect.timeout("300 millis"));

      const answer = yield* answerTo(id, "spec");
      assert.isTrue(answer.isError);
      assert.include(answer.text, "didn't answer");
      const flow = yield* flowOf(id, () => true);
      assert.isUndefined(flow?.checkpoint);
    }).pipe(
      runOn(freshDatabase(), "1 second"),
      Effect.ensuring(Effect.sync(() => (hanging = false))),
    ),
);
